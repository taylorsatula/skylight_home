/**
 * Skylight Home Dashboard v2
 *
 * A configurable home dashboard with widgets for weather, calendar,
 * device control, package tracking, notifications, and more.
 *
 * Architecture:
 * - CONFIG: Global configuration loaded from config.json
 * - Layout Engine: Renders rows and widgets based on layout config
 * - Widget Factory: Creates widgets by type with consistent interface
 * - Home Assistant: Device control via REST API
 * - WebSocket: Real-time notification updates
 */

'use strict';

// ============================================
// GLOBAL STATE
// ============================================

let CONFIG = null;
let deviceStates = {};
let shipmentsCache = [];
let notificationsCache = [];
let currentRecipeUrl = 'https://cooking.nytimes.com';
let notifySocket = null;

// Polling intervals (stored for potential cleanup)
const intervals = {
  calendar: null,
  weather: null,
  note: null,
  recipe: null,
  devices: null,
  shipping: null,
  notifications: null,
};

// Pending actions to prevent rapid toggles
const pendingActions = {};

// ============================================
// CONFIGURATION
// ============================================

/**
 * Load configuration from config.json
 */
async function loadConfig() {
  try {
    const response = await fetch('config.json');
    if (!response.ok) throw new Error('Config fetch failed');
    CONFIG = await response.json();
    return CONFIG;
  } catch (error) {
    console.error('Failed to load config.json:', error);
    // Return minimal defaults
    CONFIG = {
      weather: { latitude: 34.67, longitude: -86.50, timezone: 'America/Chicago', location: 'Unknown' },
      apis: {},
      home: { title: 'Home Dashboard' },
      layout: {
        topRow: { tiles: [] },
        middleRow: { columns: [1, 1, 1, 1], tiles: [] },
        bottomRow: { columns: [1, 1, 1, 1], tiles: [] }
      }
    };
    return CONFIG;
  }
}

// ============================================
// LAYOUT ENGINE
// ============================================

/**
 * Build grid-template-columns from tiles' width properties
 * @param {object[]} tiles - Array of tile configs
 * @returns {string} CSS value like "340px 400px 1fr"
 */
function tilesToGridColumns(tiles) {
  return tiles.map(t => t.width || '1fr').join(' ');
}

/**
 * Render the dashboard layout based on config
 */
function renderLayout() {
  const dashboard = document.getElementById('dashboard');
  const layout = CONFIG.layout;

  // Clear existing content
  dashboard.innerHTML = '';

  // Check if any tiles are configured
  const topTiles = layout?.topRow?.tiles || [];
  const middleTiles = layout?.middleRow?.tiles || [];
  const bottomTiles = layout?.bottomRow?.tiles || [];
  const totalTiles = topTiles.length + middleTiles.length + bottomTiles.length;

  if (totalTiles === 0) {
    // Show empty state with helpful message
    dashboard.innerHTML = `
      <div class="empty-state">
        <svg class="empty-state__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="3" width="7" height="7" rx="1"/>
          <rect x="14" y="3" width="7" height="7" rx="1"/>
          <rect x="3" y="14" width="7" height="7" rx="1"/>
          <rect x="14" y="14" width="7" height="7" rx="1"/>
        </svg>
        <h2 class="empty-state__title">No Widgets Configured</h2>
        <p class="empty-state__message">
          The dashboard couldn't load any widgets. This might happen if:
        </p>
        <ul class="empty-state__list">
          <li>You're viewing the file directly (file://) instead of via a web server</li>
          <li>The config.json file is missing or has no tiles configured</li>
          <li>There was an error loading the configuration</li>
        </ul>
        <p class="empty-state__hint">
          Try running: <code>python3 -m http.server 8080</code> in the v2 directory
        </p>
      </div>
    `;
    return;
  }

  // Top row: Small device tiles (flex)
  if (topTiles.length > 0) {
    const topRow = document.createElement('div');
    topRow.className = 'top-row';
    topRow.id = 'top-row';
    topTiles.forEach(tileConfig => {
      const widget = createWidget(tileConfig.type, tileConfig);
      if (widget) topRow.appendChild(widget);
    });
    dashboard.appendChild(topRow);
  }

  // Middle row: CSS Grid with per-tile widths
  if (middleTiles.length > 0) {
    const middleRow = document.createElement('div');
    middleRow.className = 'middle-row';
    middleRow.id = 'middle-row';
    middleRow.style.gridTemplateColumns = tilesToGridColumns(middleTiles);
    middleTiles.forEach(tileConfig => {
      const widget = createWidget(tileConfig.type, tileConfig);
      if (widget) middleRow.appendChild(widget);
    });
    dashboard.appendChild(middleRow);
  }

  // Bottom row: CSS Grid with per-tile widths
  if (bottomTiles.length > 0) {
    const bottomRow = document.createElement('div');
    bottomRow.className = 'bottom-row';
    bottomRow.id = 'bottom-row';
    bottomRow.style.gridTemplateColumns = tilesToGridColumns(bottomTiles);
    bottomTiles.forEach(tileConfig => {
      const widget = createWidget(tileConfig.type, tileConfig);
      if (widget) bottomRow.appendChild(widget);
    });
    dashboard.appendChild(bottomRow);
  }
}

// ============================================
// WIDGET FACTORY
// ============================================

/**
 * Widget type registry
 */
const WIDGET_TYPES = {
  // Small tiles (top row)
  'device': createDeviceTile,
  'scene': createSceneTile,

  // Large widgets (middle/bottom rows)
  'weather': createWeatherWidget,
  'calendar': createCalendarWidget,
  'note': createNoteWidget,
  'photo': createPhotoWidget,
  'recipe': createRecipeWidget,
  'shipping': createShippingWidget,
  'notifications': createNotificationsWidget,
  'deviceStack': createDeviceStackWidget,
  'placeholder': createPlaceholderWidget,
};

/**
 * Create a widget by type
 * @param {string} type - Widget type from WIDGET_TYPES
 * @param {object} config - Widget configuration
 * @returns {HTMLElement|null}
 */
function createWidget(type, config) {
  const factory = WIDGET_TYPES[type];
  if (!factory) {
    console.warn(`Unknown widget type: ${type}`);
    return createPlaceholderWidget(config);
  }
  return factory(config);
}

// ============================================
// HOME ASSISTANT INTEGRATION
// ============================================

/**
 * Make authenticated request to Home Assistant API
 */
async function haFetch(endpoint, options = {}) {
  const url = CONFIG.homeAssistant?.url || 'http://192.168.1.137:8123';
  const token = CONFIG.homeAssistant?.token || '';

  const response = await fetch(`${url}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  if (!response.ok) {
    throw new Error(`HA API error: ${response.status}`);
  }
  return response.json();
}

/**
 * Fetch single device state from Home Assistant
 */
async function fetchDevice(deviceId) {
  const deviceConfig = CONFIG.devices?.[deviceId];
  if (!deviceConfig) return null;

  try {
    const state = await haFetch(`/api/states/${deviceConfig.entity_id}`);
    const result = {
      id: deviceId,
      entity_id: deviceConfig.entity_id,
      name: deviceConfig.name,
      type: deviceConfig.type,
      icon: deviceConfig.icon,
      is_on: state.state === 'on',
      state: state.state,
      attributes: state.attributes
    };

    // Extract brightness for lights (0-255 in HA, convert to 0-100)
    if (deviceConfig.type === 'light' && state.attributes.brightness !== undefined) {
      result.brightness = Math.round((state.attributes.brightness / 255) * 100);
    }

    deviceStates[deviceId] = result;
    return result;
  } catch (error) {
    console.error(`Error fetching ${deviceId}:`, error);
    deviceStates[deviceId] = {
      id: deviceId,
      name: deviceConfig.name,
      icon: deviceConfig.icon,
      error: error.message
    };
    return deviceStates[deviceId];
  }
}

/**
 * Fetch all configured device states
 */
async function fetchAllDevices() {
  const devices = CONFIG.devices || {};
  for (const deviceId of Object.keys(devices)) {
    await fetchDevice(deviceId);
  }
  return deviceStates;
}

/**
 * Turn device on
 */
async function turnOn(deviceId) {
  const deviceConfig = CONFIG.devices?.[deviceId];
  if (!deviceConfig) return null;

  // Optimistic update
  if (deviceStates[deviceId]) {
    deviceStates[deviceId].is_on = true;
    updateDeviceTileUI(deviceId);
  }

  const domain = deviceConfig.type === 'light' ? 'light' : 'switch';
  try {
    await haFetch(`/api/services/${domain}/turn_on`, {
      method: 'POST',
      body: JSON.stringify({ entity_id: deviceConfig.entity_id })
    });
    return await fetchDevice(deviceId);
  } catch (error) {
    console.error(`Error turning on ${deviceId}:`, error);
    await fetchDevice(deviceId); // Revert optimistic update
    return null;
  }
}

/**
 * Turn device off
 */
async function turnOff(deviceId) {
  const deviceConfig = CONFIG.devices?.[deviceId];
  if (!deviceConfig) return null;

  // Optimistic update
  if (deviceStates[deviceId]) {
    deviceStates[deviceId].is_on = false;
    updateDeviceTileUI(deviceId);
  }

  const domain = deviceConfig.type === 'light' ? 'light' : 'switch';
  try {
    await haFetch(`/api/services/${domain}/turn_off`, {
      method: 'POST',
      body: JSON.stringify({ entity_id: deviceConfig.entity_id })
    });
    return await fetchDevice(deviceId);
  } catch (error) {
    console.error(`Error turning off ${deviceId}:`, error);
    await fetchDevice(deviceId); // Revert optimistic update
    return null;
  }
}

/**
 * Toggle device on/off
 */
async function toggleDevice(deviceId) {
  if (pendingActions[deviceId]) return null;
  pendingActions[deviceId] = true;

  try {
    const currentState = deviceStates[deviceId];
    if (currentState && currentState.is_on) {
      return await turnOff(deviceId);
    } else {
      return await turnOn(deviceId);
    }
  } finally {
    delete pendingActions[deviceId];
  }
}

/**
 * Set brightness for a light (0-100)
 */
async function setBrightness(deviceId, brightness) {
  const deviceConfig = CONFIG.devices?.[deviceId];
  if (!deviceConfig || deviceConfig.type !== 'light') return null;

  // Optimistic update
  if (deviceStates[deviceId]) {
    deviceStates[deviceId].brightness = brightness;
    deviceStates[deviceId].is_on = brightness > 0;
    updateDeviceTileUI(deviceId);
  }

  try {
    await haFetch('/api/services/light/turn_on', {
      method: 'POST',
      body: JSON.stringify({
        entity_id: deviceConfig.entity_id,
        brightness_pct: parseInt(brightness)
      })
    });
    return await fetchDevice(deviceId);
  } catch (error) {
    console.error(`Error setting brightness for ${deviceId}:`, error);
    await fetchDevice(deviceId);
    return null;
  }
}

/**
 * Update a single device tile's UI
 */
function updateDeviceTileUI(deviceId) {
  const state = deviceStates[deviceId];
  const tile = document.querySelector(`[data-device="${deviceId}"]`);
  if (!tile || !state) return;

  const statusEl = tile.querySelector('.tile__status');

  // Remove all state classes
  tile.classList.remove('tile--active', 'tile--on-standby', 'tile--error');

  if (state.error) {
    tile.classList.add('tile--error');
    if (statusEl) statusEl.textContent = 'Offline';
  } else if (state.is_on) {
    tile.classList.add('tile--active');
    if (statusEl) {
      statusEl.textContent = state.brightness !== undefined ? `${state.brightness}%` : 'On';
    }
  } else {
    tile.classList.add('tile--on-standby');
    if (statusEl) statusEl.textContent = 'Off';
  }
}

/**
 * Update all device tiles
 */
function updateAllDeviceTiles() {
  for (const deviceId of Object.keys(deviceStates)) {
    updateDeviceTileUI(deviceId);
  }
}

// ============================================
// WIDGET: DEVICE TILE (Small)
// ============================================

let longPressTimer = null;

function createDeviceTile(config) {
  const deviceId = config.deviceId;
  const deviceConfig = CONFIG.devices?.[deviceId];

  if (!deviceConfig) {
    console.warn(`Device not found: ${deviceId}`);
    return createPlaceholderWidget({ name: deviceId });
  }

  const tile = document.createElement('div');
  tile.className = 'tile';
  tile.dataset.device = deviceId;

  tile.innerHTML = `
    <div class="tile__icon">
      <svg class="icon"><use href="#icon-${deviceConfig.icon || 'lightbulb'}"/></svg>
    </div>
    <div class="tile__content">
      <div class="tile__name">${deviceConfig.name}</div>
      <div class="tile__status">Loading...</div>
    </div>
  `;

  // Long press for brightness (lights only)
  if (deviceConfig.type === 'light') {
    tile.addEventListener('touchstart', () => {
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        openBrightnessModal(deviceId);
      }, 500);
    }, { passive: true });

    tile.addEventListener('touchend', (e) => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
        e.preventDefault();
        toggleDevice(deviceId);
      }
    }, { passive: false });

    tile.addEventListener('touchmove', () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    }, { passive: true });
  } else {
    // Regular tap for switches
    tile.addEventListener('touchend', (e) => {
      e.preventDefault();
      toggleDevice(deviceId);
    }, { passive: false });
  }

  // Click fallback for non-touch
  tile.addEventListener('click', () => {
    if (!('ontouchend' in window)) {
      toggleDevice(deviceId);
    }
  });

  return tile;
}

// ============================================
// WIDGET: SCENE TILE
// ============================================

function createSceneTile(config) {
  // Scene tiles are placeholders for now
  return createPlaceholderWidget({ name: config.sceneId || 'Scene' });
}

// ============================================
// WIDGET: DEVICE STACK
// ============================================

function createDeviceStackWidget(config) {
  const container = document.createElement('div');
  container.className = 'tile-stack';

  const devices = config.devices || [];
  devices.forEach(deviceId => {
    // Handle both string deviceIds and objects with deviceId property
    const id = typeof deviceId === 'string' ? deviceId : deviceId.deviceId;
    const deviceConfig = CONFIG.devices?.[id];

    if (deviceConfig) {
      const tile = createDeviceTile({ deviceId: id });
      container.appendChild(tile);
    } else {
      // Create a static tile for devices not in config
      const tile = document.createElement('div');
      tile.className = 'tile tile--on-standby';
      tile.innerHTML = `
        <div class="tile__icon">
          <svg class="icon"><use href="#icon-lightbulb"/></svg>
        </div>
        <div class="tile__content">
          <div class="tile__name">${id}</div>
          <div class="tile__status">Off</div>
        </div>
      `;
      container.appendChild(tile);
    }
  });

  return container;
}

// ============================================
// WIDGET: WEATHER
// ============================================

const WEATHER_CODES = {
  0: { icon: 'weather-sun', desc: 'Clear' },
  1: { icon: 'weather-sun', desc: 'Mostly Clear' },
  2: { icon: 'weather-partly-cloudy', desc: 'Partly Cloudy' },
  3: { icon: 'weather-partly-cloudy', desc: 'Overcast' },
  45: { icon: 'weather-cloudy', desc: 'Foggy' },
  48: { icon: 'weather-cloudy', desc: 'Icy Fog' },
  51: { icon: 'weather-rain', desc: 'Light Drizzle' },
  53: { icon: 'weather-rain', desc: 'Drizzle' },
  55: { icon: 'weather-rain', desc: 'Heavy Drizzle' },
  61: { icon: 'weather-rain', desc: 'Light Rain' },
  63: { icon: 'weather-rain', desc: 'Rain' },
  65: { icon: 'weather-rain', desc: 'Heavy Rain' },
  71: { icon: 'weather-snow', desc: 'Light Snow' },
  73: { icon: 'weather-snow', desc: 'Snow' },
  75: { icon: 'weather-snow', desc: 'Heavy Snow' },
  77: { icon: 'weather-snow', desc: 'Snow Grains' },
  80: { icon: 'weather-rain', desc: 'Light Showers' },
  81: { icon: 'weather-rain', desc: 'Showers' },
  82: { icon: 'weather-rain', desc: 'Heavy Showers' },
  85: { icon: 'weather-snow', desc: 'Snow Showers' },
  86: { icon: 'weather-snow', desc: 'Heavy Snow Showers' },
  95: { icon: 'weather-storm', desc: 'Thunderstorm' },
  96: { icon: 'weather-storm', desc: 'Thunderstorm w/ Hail' },
  99: { icon: 'weather-storm', desc: 'Severe Thunderstorm' },
};

function getWeatherInfo(code) {
  return WEATHER_CODES[code] || { icon: 'weather-sun', desc: 'Unknown' };
}

function getDayName(dateStr, index) {
  if (index === 0) return 'Today';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { weekday: 'short' });
}

// Store weather widget config for fetchWeather to access
let weatherWidgetConfig = null;

// Available condition types with their labels and default values
const CONDITION_TYPES = {
  humidity: { label: 'Humidity', unit: '%', default: '--%' },
  wind: { label: 'Wind', unit: ' mph', default: '-- mph' },
  precip: { label: 'Precip', unit: '%', default: '--%' },
  uv: { label: 'UV Index', unit: '', default: '--' },
  feelsLike: { label: 'Feels Like', unit: '°', default: '--°' },
  visibility: { label: 'Visibility', unit: ' mi', default: '-- mi' },
  pressure: { label: 'Pressure', unit: ' hPa', default: '-- hPa' },
};

function createWeatherWidget(config) {
  // Store config for fetchWeather
  weatherWidgetConfig = config;

  const widget = document.createElement('div');
  widget.className = 'widget';
  widget.id = 'weather-widget';

  // Build conditions HTML based on config
  const conditions = config.conditions || ['humidity', 'wind', 'precip'];
  const conditionsHtml = conditions.map(cond => {
    const info = CONDITION_TYPES[cond] || { label: cond, default: '--' };
    return `<div class="weather__stat"><div class="weather__stat-value" id="weather-${cond}">${info.default}</div><div class="weather__stat-label">${info.label}</div></div>`;
  }).join('');

  // Determine grid columns based on number of conditions
  const gridCols = Math.min(conditions.length, 4);

  widget.innerHTML = `
    <div style="display: flex; justify-content: space-between; margin-bottom: 20px;">
      <div style="display: flex; align-items: center; gap: 16px;">
        <svg class="icon icon--2xl" id="weather-icon"><use href="#weather-sun"/></svg>
        <div>
          <div class="weather__temp"><span id="weather-temp">--</span><span class="weather__temp-unit">°</span></div>
          <div class="weather__condition" id="weather-condition">Loading...</div>
        </div>
      </div>
      <div style="text-align: right;">
        <div class="weather__location" id="weather-location">${CONFIG.weather?.location || 'Unknown'}</div>
        <div class="weather__range"><span class="weather__range-high" id="weather-high">--°</span> / <span id="weather-low">--°</span></div>
        <div class="weather__feels-like">Feels like <span id="weather-feels">--</span>°</div>
      </div>
    </div>
    <div class="section">
      <div class="section__title">Conditions</div>
      <div class="weather__stats" style="grid-template-columns: repeat(${gridCols}, 1fr);">
        ${conditionsHtml}
      </div>
    </div>
    <div class="section">
      <div class="section__title">This Week</div>
      <div class="weather__daily" id="weather-forecast"></div>
    </div>
  `;

  return widget;
}

async function fetchWeather() {
  const lat = CONFIG.weather?.latitude || 34.67;
  const lon = CONFIG.weather?.longitude || -86.50;
  const tz = CONFIG.weather?.timezone || 'America/Chicago';

  // Get forecast days from widget config (default 4, max 14)
  const forecastDays = Math.min(weatherWidgetConfig?.forecastDays || 4, 14);
  const conditions = weatherWidgetConfig?.conditions || ['humidity', 'wind', 'precip'];

  // Build API URL with required fields based on conditions
  const currentFields = ['temperature_2m', 'weather_code', 'apparent_temperature'];
  if (conditions.includes('humidity')) currentFields.push('relative_humidity_2m');
  if (conditions.includes('wind')) currentFields.push('wind_speed_10m');
  if (conditions.includes('uv')) currentFields.push('uv_index');
  if (conditions.includes('visibility')) currentFields.push('visibility');
  if (conditions.includes('pressure')) currentFields.push('surface_pressure');

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=${currentFields.join(',')}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=${encodeURIComponent(tz)}&temperature_unit=fahrenheit&wind_speed_unit=mph&forecast_days=${forecastDays}`;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Weather fetch failed');
    const data = await response.json();

    const current = data.current;
    const daily = data.daily;

    // Current conditions
    const weatherInfo = getWeatherInfo(current.weather_code);
    const iconEl = document.getElementById('weather-icon');
    if (iconEl) iconEl.innerHTML = `<use href="#${weatherInfo.icon}"/>`;

    setTextContent('weather-temp', Math.round(current.temperature_2m));
    setTextContent('weather-condition', weatherInfo.desc);
    setTextContent('weather-feels', Math.round(current.apparent_temperature));

    // Today's high/low
    setTextContent('weather-high', Math.round(daily.temperature_2m_max[0]) + '°');
    setTextContent('weather-low', Math.round(daily.temperature_2m_min[0]) + '°');

    // Update condition values based on what's configured
    conditions.forEach(cond => {
      let value = '--';
      const info = CONDITION_TYPES[cond] || { unit: '' };
      switch (cond) {
        case 'humidity':
          value = (current.relative_humidity_2m || 0) + info.unit;
          break;
        case 'wind':
          value = Math.round(current.wind_speed_10m || 0) + info.unit;
          break;
        case 'precip':
          value = (daily.precipitation_probability_max[0] || 0) + info.unit;
          break;
        case 'uv':
          value = Math.round(current.uv_index || 0) + info.unit;
          break;
        case 'feelsLike':
          value = Math.round(current.apparent_temperature || 0) + info.unit;
          break;
        case 'visibility':
          value = Math.round((current.visibility || 0) / 1609.34) + info.unit; // meters to miles
          break;
        case 'pressure':
          value = Math.round(current.surface_pressure || 0) + info.unit;
          break;
      }
      setTextContent(`weather-${cond}`, value);
    });

    // Calculate temp range for bar positioning
    const allTemps = [...daily.temperature_2m_max, ...daily.temperature_2m_min];
    const minTemp = Math.min(...allTemps);
    const maxTemp = Math.max(...allTemps);
    const tempRange = maxTemp - minTemp || 1;

    // Build forecast HTML
    const forecastEl = document.getElementById('weather-forecast');
    if (forecastEl) {
      // Add scrollable class if more than 4 days
      if (forecastDays > 4) {
        forecastEl.classList.add('weather__daily--scrollable');
      }

      forecastEl.innerHTML = daily.time.slice(0, forecastDays).map((date, i) => {
        const dayInfo = getWeatherInfo(daily.weather_code[i]);
        const low = Math.round(daily.temperature_2m_min[i]);
        const high = Math.round(daily.temperature_2m_max[i]);
        const precip = daily.precipitation_probability_max[i] || 0;

        const barLeft = ((low - minTemp) / tempRange) * 100;
        const barWidth = ((high - low) / tempRange) * 100;

        return `
          <div class="weather__day ${i === 0 ? 'weather__day--today' : ''}">
            <span class="weather__day-name">${getDayName(date, i)}</span>
            <svg style="width: 28px; height: 28px;"><use href="#${dayInfo.icon}"/></svg>
            <span class="weather__day-precip">${precip > 0 ? precip + '%' : ''}</span>
            <div class="weather__day-temps">
              <span class="weather__day-low">${low}°</span>
              <div class="weather__day-bar"><div class="weather__day-bar-fill" style="left: ${barLeft}%; width: ${barWidth}%;"></div></div>
              <span class="weather__day-high">${high}°</span>
            </div>
          </div>
        `;
      }).join('');
    }
  } catch (error) {
    console.error('Error fetching weather:', error);
    setTextContent('weather-condition', 'Error loading');
  }
}

// ============================================
// WIDGET: CALENDAR
// ============================================

function createCalendarWidget(config) {
  const widget = document.createElement('div');
  widget.className = 'widget';
  widget.id = 'calendar-widget';
  widget.style.cssText = 'overflow-y: auto;';

  widget.innerHTML = `<div class="calendar__loading">Loading events...</div>`;

  return widget;
}

async function fetchCalendar() {
  const apiUrl = CONFIG.apis?.calendar || 'http://192.168.1.137:8889/api/calendar';

  const widget = document.getElementById('calendar-widget');
  if (!widget) return;

  try {
    const response = await fetch(apiUrl);
    if (!response.ok) throw new Error('Calendar fetch failed');

    const events = await response.json();

    if (events.length === 0) {
      widget.innerHTML = `<div class="calendar__empty">No upcoming events</div>`;
      return;
    }

    // Group events by date
    const grouped = groupEventsByDate(events);
    renderCalendarEvents(widget, grouped);
  } catch (error) {
    console.error('Error fetching calendar:', error);
    widget.innerHTML = `<div class="calendar__error">Unable to load calendar</div>`;
  }
}

function groupEventsByDate(events) {
  const grouped = {};
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  events.forEach(event => {
    // Get the date (handle all-day vs timed events)
    const startDate = event.start.date || event.start.dateTime.split('T')[0];

    if (!grouped[startDate]) {
      grouped[startDate] = [];
    }
    grouped[startDate].push(event);
  });

  return grouped;
}

function formatEventDate(dateStr) {
  const date = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (date.getTime() === today.getTime()) {
    return { text: 'Today', isFuture: false };
  } else if (date.getTime() === tomorrow.getTime()) {
    return { text: 'Tomorrow', isFuture: true };
  } else {
    const options = { weekday: 'long', month: 'short', day: 'numeric' };
    return { text: date.toLocaleDateString('en-US', options), isFuture: date > today };
  }
}

function formatEventTime(event) {
  // All-day event
  if (event.start.date) {
    return { start: 'all-day', end: null, isAllDay: true };
  }

  const start = new Date(event.start.dateTime);
  const end = new Date(event.end.dateTime);

  const formatTime = (d) => d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).replace(' ', '');

  return { start: formatTime(start), end: formatTime(end), isAllDay: false };
}

function isHoliday(event) {
  // Check if event looks like a holiday (from holiday calendars or has certain keywords)
  const title = (event.summary || '').toLowerCase();
  const holidayKeywords = ['holiday', 'christmas', 'thanksgiving', 'easter', 'hanukkah', 'new year', 'memorial', 'labor day', 'independence', 'veterans'];
  return holidayKeywords.some(kw => title.includes(kw)) || event.start.date; // All-day events often holidays
}

function getEventBarClass(event, index) {
  if (isHoliday(event)) return 'event-item__bar--holiday';
  // Rotate through accent colors for variety
  const colors = ['', 'event-item__bar--purple', 'event-item__bar--success'];
  return colors[index % colors.length];
}

function renderCalendarEvents(widget, grouped) {
  const dates = Object.keys(grouped).sort();

  let html = '';
  dates.forEach(dateStr => {
    const { text: dateText, isFuture } = formatEventDate(dateStr);
    const events = grouped[dateStr];

    html += `
      <div class="event-list__section">
        <div class="event-list__date${isFuture ? ' event-list__date--future' : ''}">${dateText}</div>
        <div class="event-list__items">
    `;

    events.forEach((event, i) => {
      const time = formatEventTime(event);
      const holiday = isHoliday(event);
      const barClass = getEventBarClass(event, i);
      const title = event.summary || 'Untitled Event';

      html += `
        <div class="event-item${holiday ? ' event-item--holiday' : ''}">
          <div class="event-item__bar ${barClass}"></div>
          <div class="event-item__content">
            <div class="event-item__title">${holiday ? '<svg class="icon icon--sm icon--filled" style="color: var(--color-alert); vertical-align: middle; margin-right: 4px;"><use href="#icon-star"/></svg>' : ''}${title}</div>
          </div>
          <div class="event-item__time">
            <span class="event-item__time-start"${holiday ? ' style="color: var(--color-alert);"' : ''}>${time.start}</span>
            ${time.end ? `<span class="event-item__time-end">${time.end}</span>` : ''}
          </div>
        </div>
      `;
    });

    html += `
        </div>
      </div>
    `;
  });

  widget.innerHTML = html;
}

// ============================================
// WIDGET: NOTE
// ============================================

function createNoteWidget(config) {
  const widget = document.createElement('div');
  widget.className = 'widget';
  widget.id = 'note-widget';
  widget.style.cssText = 'display: flex; flex-direction: column; overflow: hidden;';

  widget.innerHTML = `
    <div class="note__header">
      <span class="note__title">Veggies</span>
      <button class="btn btn--icon" id="note-edit-btn"><svg class="icon icon--sm"><use href="#icon-edit"/></svg></button>
    </div>
    <div class="note__content" id="note-content" style="flex: 1; overflow-y: auto; min-height: 0;">Loading...</div>
    <div class="note__timestamp" id="note-timestamp"></div>
  `;

  // Set up edit button handler after DOM is ready
  setTimeout(() => {
    const editBtn = document.getElementById('note-edit-btn');
    if (editBtn) {
      editBtn.addEventListener('click', openNoteModal);
      editBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        openNoteModal();
      });
    }
  }, 0);

  return widget;
}

async function fetchNote() {
  const noteApi = CONFIG.apis?.note;
  if (!noteApi) return;

  try {
    const response = await fetch(noteApi);
    if (!response.ok) throw new Error('Failed to fetch note');
    const data = await response.json();

    setInnerHTML('note-content', data.html || 'No content');
    setTextContent('note-timestamp', 'Synced with Apple Notes');
  } catch (error) {
    console.error('Error fetching note:', error);
    setInnerHTML('note-content', 'Unable to load note');
    setTextContent('note-timestamp', 'Check Mac connection');
  }
}

async function saveNote(html) {
  const noteApi = CONFIG.apis?.note;
  if (!noteApi) return false;

  try {
    const response = await fetch(noteApi, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html })
    });
    if (!response.ok) throw new Error('Failed to save note');
    await fetchNote();
    return true;
  } catch (error) {
    console.error('Error saving note:', error);
    return false;
  }
}

// ============================================
// WIDGET: PHOTO
// ============================================

function createPhotoWidget(config) {
  const container = document.createElement('div');
  container.className = 'photo-frame';

  const img = document.createElement('img');
  img.className = 'photo-frame__image';
  img.src = config.src || 'photo.jpeg';
  img.alt = 'Photo';
  img.style.cssText = 'object-fit: cover; object-position: center;';

  container.appendChild(img);
  return container;
}

// ============================================
// WIDGET: RECIPE
// ============================================

function createRecipeWidget(config) {
  const widget = document.createElement('div');
  widget.className = 'recipe';
  widget.id = 'recipe-widget';

  widget.innerHTML = `
    <img
      class="recipe__image"
      id="recipe-image"
      src="https://images.unsplash.com/photo-1546549032-9571cd6b27df?w=600&h=450&fit=crop"
      alt="Recipe"
    />
    <div class="recipe__overlay">
      <div class="recipe__source">
        <span class="recipe__source-logo">NYT</span> Cooking · Recipe of the Day
      </div>
      <h3 class="recipe__title" id="recipe-title">Loading...</h3>
      <div class="recipe__meta">
        <div class="recipe__meta-item" id="recipe-time">
          <svg class="icon icon--sm"><use href="#icon-clock"/></svg>
          <span>--</span>
        </div>
        <div class="recipe__meta-item" id="recipe-servings">
          <svg class="icon icon--sm"><use href="#icon-users"/></svg>
          <span>--</span>
        </div>
      </div>
    </div>
  `;

  // Tap handler for QR modal
  widget.addEventListener('touchend', (e) => {
    e.preventDefault();
    showRecipeQR();
  }, { passive: false });

  widget.addEventListener('click', () => {
    if (!('ontouchend' in window)) {
      showRecipeQR();
    }
  });

  return widget;
}

async function fetchRecipe() {
  const recipeApi = CONFIG.apis?.recipe;
  if (!recipeApi) return;

  try {
    const response = await fetch(recipeApi);
    if (!response.ok) throw new Error('Failed to fetch recipe');
    const recipe = await response.json();

    currentRecipeUrl = recipe.url || 'https://cooking.nytimes.com';

    setTextContent('recipe-title', recipe.title || 'Recipe of the Day');

    const imgEl = document.getElementById('recipe-image');
    if (imgEl && recipe.image) {
      imgEl.src = recipe.image;
    }

    const timeEl = document.querySelector('#recipe-time span');
    const servingsEl = document.querySelector('#recipe-servings span');

    if (timeEl) timeEl.textContent = recipe.time || '--';
    if (servingsEl) servingsEl.textContent = recipe.servings ? `${recipe.servings} servings` : '--';
  } catch (error) {
    console.error('Error fetching recipe:', error);
  }
}

function showRecipeQR() {
  const modal = document.getElementById('qr-modal');
  const qrContainer = document.getElementById('qr-code');
  const titleEl = document.getElementById('recipe-title');

  if (modal && qrContainer) {
    const title = titleEl?.textContent || 'Recipe';
    setTextContent('qr-modal-title', title);

    const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(currentRecipeUrl);
    qrContainer.innerHTML = `<img src="${qrUrl}" alt="QR Code" style="width:200px;height:200px;">`;

    modal.classList.add('active');
  }
}

// ============================================
// WIDGET: SHIPPING
// ============================================

function createShippingWidget(config) {
  const widget = document.createElement('div');
  widget.className = 'widget';
  widget.id = 'shipping-widget';
  widget.style.cssText = 'padding: 0; overflow: hidden;';

  widget.innerHTML = `
    <div id="shipping-list-view">
      <div class="package-list__header">
        <span class="package-list__title">Incoming Packages</span>
        <span class="package-list__count" id="shipping-count">0 active</span>
      </div>
      <div id="shipping-list" style="overflow-y: auto; max-height: calc(100% - 48px);"></div>
    </div>
    <div id="shipping-detail-view" style="display: none; height: 100%; overflow-y: auto;">
      <div class="package-list__header" style="cursor: pointer;" id="shipping-back-btn">
        <svg class="icon icon--sm" style="color: var(--text-muted); transform: rotate(180deg); margin-right: 8px;"><use href="#icon-chevron"/></svg>
        <span class="package-list__title">Back</span>
      </div>
      <div id="shipping-detail-content" style="padding: 16px;"></div>
    </div>
  `;

  // Set up back button handler
  setTimeout(() => {
    const backBtn = document.getElementById('shipping-back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', showShippingList);
    }
  }, 0);

  return widget;
}

const STATUS_MAP = {
  'Pending': { class: 'badge--pending', label: 'Pending' },
  'InfoReceived': { class: 'badge--info', label: 'Label Created' },
  'InTransit': { class: 'badge--warning', label: 'In Transit' },
  'OutForDelivery': { class: 'badge--alert', label: 'Out for Delivery' },
  'AttemptFail': { class: 'badge--error', label: 'Failed Attempt' },
  'Delivered': { class: 'badge--success', label: 'Delivered' },
  'AvailableForPickup': { class: 'badge--info', label: 'Ready for Pickup' },
  'Exception': { class: 'badge--error', label: 'Exception' },
  'Expired': { class: 'badge--error', label: 'Expired' }
};

const CARRIER_MAP = {
  'ups': { class: 'package__carrier--ups', label: 'UPS' },
  'fedex': { class: 'package__carrier--fedex', label: 'FDX' },
  'usps': { class: 'package__carrier--usps', label: 'USPS' },
  'dhl': { class: 'package__carrier--dhl', label: 'DHL' },
  'amazon': { class: 'package__carrier--amazon', label: 'AMZ' },
  'amazon-fba-us': { class: 'package__carrier--amazon', label: 'AMZ' },
};

function getStatusInfo(tag) {
  return STATUS_MAP[tag] || { class: 'badge--pending', label: tag };
}

function getCarrierInfo(slug) {
  return CARRIER_MAP[slug] || { class: 'package__carrier--other', label: 'PKG' };
}

function formatEta(expectedDelivery) {
  if (!expectedDelivery) return '--';
  const date = new Date(expectedDelivery);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

async function fetchShipments() {
  const apiKey = CONFIG.apis?.aftership_key;
  const apiUrl = CONFIG.apis?.aftership;

  if (!apiKey || !apiUrl) {
    renderShippingList([]);
    return;
  }

  try {
    const response = await fetch(apiUrl, {
      headers: { 'aftership-api-key': apiKey }
    });
    if (!response.ok) throw new Error('Failed to fetch shipments');
    const data = await response.json();
    shipmentsCache = data.data?.trackings || [];
    renderShippingList(shipmentsCache);
  } catch (error) {
    console.error('Error fetching shipments:', error);
    renderShippingList([]);
  }
}

function renderShippingList(trackings) {
  const listEl = document.getElementById('shipping-list');
  const countEl = document.getElementById('shipping-count');
  if (!listEl) return;

  // Filter to active (non-delivered) packages
  const active = trackings.filter(t => t.tag !== 'Delivered');
  if (countEl) countEl.textContent = `${active.length} active`;

  if (active.length === 0) {
    listEl.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);">No packages to track</div>';
    return;
  }

  listEl.innerHTML = active.map((tracking, index) => {
    const status = getStatusInfo(tracking.tag);
    const carrier = getCarrierInfo(tracking.slug);
    const eta = formatEta(tracking.expected_delivery);
    const isToday = eta === 'Today';

    return `
      <div class="package-list__item" data-tracking-index="${index}" style="cursor: pointer;">
        <div class="package-list__item-carrier ${carrier.class}">${carrier.label}</div>
        <div class="package-list__item-info">
          <div class="package-list__item-title">${tracking.title || 'Package'}</div>
          <div class="package-list__item-status" style="${tracking.tag === 'OutForDelivery' ? 'color: var(--status-out);' : ''}">${status.label}</div>
        </div>
        <div class="package-list__item-eta ${isToday ? 'package-list__item-eta--today' : ''}">${eta}</div>
        <svg class="icon icon--sm" style="color: var(--text-muted);"><use href="#icon-chevron"/></svg>
      </div>
    `;
  }).join('');

  // Add click handlers
  listEl.querySelectorAll('.package-list__item').forEach(item => {
    item.addEventListener('click', () => {
      const index = parseInt(item.dataset.trackingIndex);
      showShippingDetail(active[index]);
    });
  });
}

function showShippingDetail(tracking) {
  const listView = document.getElementById('shipping-list-view');
  const detailView = document.getElementById('shipping-detail-view');
  const detailContent = document.getElementById('shipping-detail-content');

  if (!listView || !detailView || !detailContent) return;

  const status = getStatusInfo(tracking.tag);
  const carrier = getCarrierInfo(tracking.slug);
  const checkpoints = tracking.checkpoints || [];

  detailContent.innerHTML = `
    <div class="package__header" style="margin-bottom: 16px;">
      <div class="package__carrier ${carrier.class}">${carrier.label}</div>
      <div class="package__info">
        <div class="package__title">${tracking.title || 'Package'}</div>
        <div class="package__subtitle">${tracking.slug?.toUpperCase() || 'Carrier'}</div>
        <div class="package__tracking">${tracking.tracking_number}</div>
      </div>
      <div class="badge ${status.class}"><span class="badge__dot"></span>${status.label}</div>
    </div>
    ${tracking.expected_delivery ? `
      <div style="margin-bottom: 16px; padding: 12px; background: var(--surface-inset); border-radius: var(--radius-lg);">
        <div style="font-size: 12px; color: var(--text-muted); text-transform: uppercase;">Expected Delivery</div>
        <div style="font-size: 18px; font-weight: 600;">${formatEta(tracking.expected_delivery)}</div>
      </div>
    ` : ''}
    <div class="package__timeline">
      ${checkpoints.slice(0, 5).map((cp, i) => {
        const dotClass = i === 0 ? 'package__timeline-dot--current' : 'package__timeline-dot--complete';
        const date = new Date(cp.checkpoint_time);
        const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `
          <div class="package__timeline-item">
            <div class="package__timeline-dot ${dotClass}"></div>
            <div class="package__timeline-content">
              <div class="package__timeline-title">${cp.message || cp.tag}</div>
              ${cp.location ? `<div class="package__timeline-location">${cp.location}</div>` : ''}
            </div>
            <div class="package__timeline-time">${timeStr}<br>${dateStr}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  listView.style.display = 'none';
  detailView.style.display = 'block';
}

function showShippingList() {
  const listView = document.getElementById('shipping-list-view');
  const detailView = document.getElementById('shipping-detail-view');
  if (listView) listView.style.display = 'block';
  if (detailView) detailView.style.display = 'none';
}

// ============================================
// WIDGET: NOTIFICATIONS
// ============================================

function createNotificationsWidget(config) {
  const widget = document.createElement('div');
  widget.className = 'widget notify-panel';
  widget.id = 'notifications-widget';

  // Initial empty state
  renderNotifications([]);

  return widget;
}

function getNotificationIcon(icon) {
  const iconMap = {
    'alert': '#icon-alert',
    'star': '#icon-star',
    'clock': '#icon-clock',
    'check-circle': '#icon-check-circle'
  };
  return iconMap[icon] || '#icon-alert';
}

async function fetchNotifications() {
  const apiUrl = CONFIG.apis?.notifications;
  if (!apiUrl) {
    renderNotifications([]);
    return;
  }

  try {
    const response = await fetch(apiUrl);
    if (!response.ok) throw new Error('Failed to fetch notifications');
    notificationsCache = await response.json();
    renderNotifications(notificationsCache);
  } catch (error) {
    console.error('Error fetching notifications:', error);
    renderNotifications([]);
  }
}

function renderNotifications(notifications) {
  const widget = document.getElementById('notifications-widget');
  if (!widget) return;

  // Reset classes
  widget.className = 'widget notify-panel';

  if (notifications.length === 0) {
    // Calm state - no notifications
    widget.classList.add('notify-panel--calm');
    widget.innerHTML = `
      <div class="notify-panel__header">
        <div class="notify-panel__status">
          <div class="notify-panel__dot"></div>
          <span class="notify-panel__status-text">All Clear</span>
        </div>
        <span class="notify-panel__timestamp">Updated just now</span>
      </div>
      <div class="notify-panel__calm-state">
        <svg class="icon icon--2xl"><use href="#icon-check-circle"/></svg>
        <div class="notify-panel__calm-text">No alerts or reminders</div>
        <div class="notify-panel__calm-subtext">Enjoy your day</div>
      </div>
    `;
    return;
  }

  // Show max 2 alerts
  const visibleAlerts = notifications.slice(0, 2);
  const isSingle = visibleAlerts.length === 1;

  // Determine header status based on highest priority present
  const hasUrgent = notifications.some(n => n.priority === 'urgent');
  const hasNormal = notifications.some(n => n.priority === 'normal');
  const statusText = hasUrgent ? 'Alerts' : hasNormal ? 'Notices' : 'Info';
  const dotClass = hasUrgent ? 'notify-panel__dot--urgent notify-panel__dot--pulse' : hasNormal ? 'notify-panel__dot--normal' : 'notify-panel__dot--info';

  widget.innerHTML = `
    <div class="notify-panel__header">
      <div class="notify-panel__status">
        <div class="notify-panel__dot ${dotClass}"></div>
        <span class="notify-panel__status-text">${statusText}</span>
      </div>
      <span class="notify-panel__timestamp">Updated just now</span>
    </div>
    <div class="notify-panel__alerts${isSingle ? '' : ' notify-panel__alerts--dual'}">
      ${visibleAlerts.map((n, i) => {
        const alertClass = n.priority === 'urgent' ? 'notify-panel__alert--urgent' :
                          n.priority === 'normal' ? 'notify-panel__alert--normal' : 'notify-panel__alert--info';
        return `
        <div class="notify-panel__alert ${alertClass}" data-notification-id="${n.id}">
          <svg class="icon icon--${isSingle ? '2xl' : 'xl'}"><use href="${getNotificationIcon(n.icon)}"/></svg>
          <div class="notify-panel__alert-text">
            <div class="notify-panel__alert-title">${n.title}</div>
            ${n.message ? `<div class="notify-panel__alert-subtitle">${n.message}</div>` : ''}
          </div>
          ${!n.recurring ? `<button class="notify-panel__dismiss" data-id="${n.id}" title="Dismiss"><svg class="icon icon--sm"><use href="#icon-x"/></svg></button>` : ''}
        </div>
      `}).join('')}
    </div>
  `;

  // Set up individual dismiss buttons
  widget.querySelectorAll('.notify-panel__dismiss').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      dismissNotification(id);
    });
  });
}

async function dismissNotification(id) {
  const apiUrl = CONFIG.apis?.notifications;
  if (!apiUrl || !id) return;

  try {
    await fetch(`${apiUrl}/${id}`, { method: 'DELETE' });
    fetchNotifications();
  } catch (error) {
    console.error('Error dismissing notification:', error);
  }
}

async function dismissAllNotifications() {
  const apiUrl = CONFIG.apis?.notifications;
  if (!apiUrl) return;

  for (const notif of notificationsCache) {
    if (!notif.recurring) {
      try {
        await fetch(`${apiUrl}/${notif.id}`, { method: 'DELETE' });
      } catch (e) {
        console.error('Error dismissing notification:', e);
      }
    }
  }
  fetchNotifications();
}

function connectNotifyWebSocket() {
  const baseUrl = CONFIG.apis?.notifications || '';
  const wsUrl = baseUrl.replace('http', 'ws').replace(':8889', ':8890') || 'ws://192.168.1.137:8890';

  try {
    notifySocket = new WebSocket(wsUrl);

    notifySocket.onopen = () => {
      console.log('[WebSocket] Connected for notifications');
    };

    notifySocket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'notifications') {
          notificationsCache = msg.data;
          renderNotifications(notificationsCache);
        } else if (msg.type === 'reload') {
          console.log('[WebSocket] Reload command received, refreshing page...');
          window.location.reload();
        }
      } catch (e) {
        console.error('[WebSocket] Parse error:', e);
      }
    };

    notifySocket.onclose = () => {
      console.log('[WebSocket] Disconnected, reconnecting in 5s...');
      setTimeout(connectNotifyWebSocket, 5000);
    };

    notifySocket.onerror = (err) => {
      console.error('[WebSocket] Error:', err);
    };
  } catch (e) {
    console.error('[WebSocket] Failed to connect:', e);
    setTimeout(connectNotifyWebSocket, 5000);
  }
}

// ============================================
// WIDGET: PLACEHOLDER
// ============================================

function createPlaceholderWidget(config) {
  const widget = document.createElement('div');
  widget.className = 'widget';
  widget.style.cssText = 'display: flex; align-items: center; justify-content: center; color: var(--text-muted);';
  widget.textContent = config.name || 'Placeholder';
  return widget;
}

// ============================================
// MODALS
// ============================================

// Brightness Modal
let brightnessModalDevice = null;
let isDragging = false;

function openBrightnessModal(deviceId) {
  const state = deviceStates[deviceId];
  const deviceConfig = CONFIG.devices?.[deviceId];
  if (!state || !deviceConfig) return;

  brightnessModalDevice = deviceId;
  setTextContent('brightness-modal-name', deviceConfig.name);
  updateBrightnessDisplay(state.brightness || 100);

  const modal = document.getElementById('brightness-modal');
  if (modal) modal.classList.add('active');
}

function closeBrightnessModal() {
  const modal = document.getElementById('brightness-modal');
  if (modal) modal.classList.remove('active');
  brightnessModalDevice = null;
}

function updateBrightnessDisplay(value) {
  setTextContent('brightness-modal-value', `${Math.round(value)}%`);
  const fill = document.getElementById('brightness-fill');
  if (fill) fill.style.height = `${value}%`;
}

function setupBrightnessSlider() {
  const slider = document.getElementById('brightness-slider');
  const track = document.getElementById('brightness-track');
  const modal = document.getElementById('brightness-modal');

  if (!slider || !track || !modal) return;

  function handleSliderInteraction(e) {
    if (!brightnessModalDevice) return;

    const rect = slider.getBoundingClientRect();
    const y = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
    const percent = Math.max(1, Math.min(100, 100 - (y / rect.height * 100)));

    updateBrightnessDisplay(percent);
    return percent;
  }

  track.addEventListener('touchstart', (e) => {
    isDragging = true;
    handleSliderInteraction(e);
  }, { passive: true });

  track.addEventListener('touchmove', (e) => {
    if (isDragging) handleSliderInteraction(e);
  }, { passive: true });

  track.addEventListener('touchend', (e) => {
    if (isDragging && brightnessModalDevice) {
      const rect = slider.getBoundingClientRect();
      const touch = e.changedTouches[0];
      const y = touch.clientY - rect.top;
      const percent = Math.max(1, Math.min(100, 100 - (y / rect.height * 100)));
      setBrightness(brightnessModalDevice, Math.round(percent));
    }
    isDragging = false;
  }, { passive: true });

  // Close on backdrop click
  modal.querySelector('.modal__backdrop')?.addEventListener('click', closeBrightnessModal);
}

// Note Modal
function openNoteModal() {
  const content = document.getElementById('note-content');
  const editor = document.getElementById('note-editor');
  const modal = document.getElementById('note-modal');

  if (content && editor && modal) {
    editor.value = content.innerText;
    modal.classList.add('active');
  }
}

function closeNoteModal() {
  const modal = document.getElementById('note-modal');
  if (modal) modal.classList.remove('active');
}

function setupNoteModal() {
  const modal = document.getElementById('note-modal');
  const closeBtn = document.getElementById('note-close');
  const saveBtn = document.getElementById('note-save');

  if (closeBtn) closeBtn.addEventListener('click', closeNoteModal);

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const editor = document.getElementById('note-editor');
      if (!editor) return;

      const text = editor.value;
      const html = text.split('\n').map(line => '<div>' + (line || '<br>') + '</div>').join('');

      if (await saveNote(html)) {
        closeNoteModal();
      }
    });
  }

  // Close on backdrop click
  modal?.querySelector('.modal__backdrop')?.addEventListener('click', closeNoteModal);
}

// QR Modal
function setupQRModal() {
  const modal = document.getElementById('qr-modal');
  modal?.querySelector('.modal__backdrop')?.addEventListener('click', () => {
    modal.classList.remove('active');
  });
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

function setTextContent(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setInnerHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function updateDate() {
  const options = { weekday: 'long', month: 'long', day: 'numeric' };
  const dateStr = new Date().toLocaleDateString('en-US', options);
  setTextContent('current-date', dateStr);
}

// ============================================
// INITIALIZATION
// ============================================

async function init() {
  try {
    // 1. Load config first
    await loadConfig();

    // 2. Apply config to header
    setTextContent('home-title', CONFIG.home?.title || 'Home Dashboard');
    updateDate();

    // 3. Render layout based on config
    renderLayout();

    // 4. Set up modals
    setupBrightnessSlider();
    setupNoteModal();
    setupQRModal();

    // 5. Initialize all widgets in parallel
    await Promise.all([
      fetchCalendar(),
      fetchWeather(),
      fetchNote(),
      fetchRecipe(),
      fetchShipments(),
      fetchNotifications(),
      fetchAllDevices().then(updateAllDeviceTiles),
    ]);

    // 6. Start refresh intervals
    intervals.calendar = setInterval(fetchCalendar, 21600000);   // 6 hours
    intervals.weather = setInterval(fetchWeather, 1800000);      // 30 min
    intervals.note = setInterval(fetchNote, 30000);              // 30 sec
    intervals.recipe = setInterval(fetchRecipe, 3600000);        // 1 hour
    intervals.devices = setInterval(() => {
      fetchAllDevices().then(updateAllDeviceTiles);
    }, 10000);                                                    // 10 sec
    intervals.shipping = setInterval(fetchShipments, 300000);    // 5 min
    intervals.notifications = setInterval(fetchNotifications, 300000); // 5 min fallback

    // 7. Update date hourly
    setInterval(updateDate, 3600000);

    // 8. Connect WebSocket for real-time notifications
    connectNotifyWebSocket();

    console.log('Skylight Home v2 initialized');
  } catch (error) {
    console.error('Initialization error:', error);
  }
}

// Start when DOM is ready
document.addEventListener('DOMContentLoaded', init);
