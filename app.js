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

// CONFIG is defined in shared/core.js
let deviceStates = {};
let shipmentsCache = [];
let notificationsCache = [];
let remindersCache = [];
let currentRecipeUrl = 'https://cooking.nytimes.com';
let notifySocket = null;

// Sleep mode state
let isSleeping = false;
let sleepCheckInterval = null;
let currentDisplayState = 'normal'; // normal, dim, sleep

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

// Reminders state
let remindersPendingRequests = new Set();
let renderedReminderIds = new Set();

// ============================================
// CONFIGURATION
// ============================================

// loadConfig is defined in shared/core.js
// Dashboard-specific default layout handled in init()

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
  'reminders': createRemindersWidget,
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

// haFetch is defined in shared/core.js

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

// WEATHER_CODES, getWeatherInfo, getDayName are defined in shared/core.js

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

  // Initial loading state - content will be rendered by shared WeatherWidget
  widget.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-muted);">
      Loading weather...
    </div>
  `;

  return widget;
}

async function fetchWeather() {
  // Use shared WeatherWidget from shared/widgets.js
  const config = {
    weather: CONFIG.weather,
    forecastDays: weatherWidgetConfig?.forecastDays || 4,
    conditions: weatherWidgetConfig?.conditions || ['humidity', 'wind', 'precip']
  };

  await WeatherWidget.fetch(config);

  const container = document.getElementById('weather-widget');
  if (container) {
    WeatherWidget.render(container, config);
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
    <div id="shipping-list-view" style="padding: var(--spacing-lg);">
      <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-muted);">Loading...</div>
    </div>
    <div id="shipping-detail-view" style="display: none; height: 100%; overflow-y: auto;">
      <div class="shipping-widget__header" style="cursor: pointer; padding: var(--spacing-lg);" id="shipping-back-btn">
        <svg class="icon icon--sm" style="color: var(--text-muted); transform: rotate(180deg); margin-right: 8px;"><use href="#icon-chevron"/></svg>
        <span class="shipping-widget__title">Back</span>
      </div>
      <div id="shipping-detail-content" style="padding: 0 var(--spacing-lg) var(--spacing-lg);"></div>
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

async function fetchShipments() {
  // Use shared ShippingWidget from shared/widgets.js
  const config = {
    apiKey: CONFIG.apis?.aftership_key,
    apiUrl: CONFIG.apis?.aftership
  };

  await ShippingWidget.fetch(config);
  shipmentsCache = ShippingWidget.state;

  const listView = document.getElementById('shipping-list-view');
  if (listView) {
    ShippingWidget.render(listView, { maxItems: 10 });
    setupShippingClickHandlers();
  }
}

function setupShippingClickHandlers() {
  const listView = document.getElementById('shipping-list-view');
  if (!listView) return;

  // Add click handlers using unified class name
  listView.querySelectorAll('.shipping-widget__package').forEach(item => {
    item.addEventListener('click', () => {
      const index = parseInt(item.dataset.trackingIndex);
      const tracking = ShippingWidget.getTracking(index);
      if (tracking) showShippingDetail(tracking);
    });
  });
}

function showShippingDetail(tracking) {
  const listView = document.getElementById('shipping-list-view');
  const detailView = document.getElementById('shipping-detail-view');
  const detailContent = document.getElementById('shipping-detail-content');

  if (!listView || !detailView || !detailContent) return;

  const status = ShippingWidget.getStatusInfo(tracking.tag);
  const carrier = ShippingWidget.getCarrierInfo(tracking.slug);
  const eta = ShippingWidget.formatEta(tracking.expected_delivery);
  const checkpoints = tracking.checkpoints || [];

  detailContent.innerHTML = `
    <div class="shipping-widget__detail-header" style="display: flex; align-items: flex-start; gap: var(--spacing-md); margin-bottom: var(--spacing-lg);">
      <div class="shipping-widget__carrier shipping-widget__carrier--${tracking.slug}">${carrier.label}</div>
      <div style="flex: 1;">
        <div style="font-size: 17px; font-weight: 600;">${tracking.title || 'Package'}</div>
        <div style="font-size: 13px; color: var(--text-secondary);">${tracking.slug?.toUpperCase() || 'Carrier'}</div>
        <div style="font-size: 12px; color: var(--text-muted); font-family: var(--font-mono);">${tracking.tracking_number}</div>
      </div>
      <div class="badge ${status.class}"><span class="badge__dot"></span>${status.label}</div>
    </div>
    ${tracking.expected_delivery ? `
      <div style="margin-bottom: var(--spacing-lg); padding: var(--spacing-md); background: var(--surface-inset); border-radius: var(--radius-lg);">
        <div style="font-size: 12px; color: var(--text-muted); text-transform: uppercase;">Expected Delivery</div>
        <div style="font-size: 18px; font-weight: 600;">${eta}</div>
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
  widget.className = 'widget';
  widget.id = 'notifications-widget';

  // Initial empty state - content will be rendered by shared NotificationsWidget
  widget.innerHTML = `<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-muted);">Loading...</div>`;

  return widget;
}

async function fetchNotifications() {
  // Use shared NotificationsWidget from shared/widgets.js
  const config = {
    apiUrl: CONFIG.apis?.notifications
  };

  await NotificationsWidget.fetch(config);
  notificationsCache = NotificationsWidget.state;

  const container = document.getElementById('notifications-widget');
  if (container) {
    NotificationsWidget.render(container);
    setupNotificationDismissHandlers();
  }
}

function setupNotificationDismissHandlers() {
  const widget = document.getElementById('notifications-widget');
  if (!widget) return;

  // Set up dismiss buttons using the unified class name
  widget.querySelectorAll('.notify-widget__dismiss').forEach(btn => {
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
// WIDGET: REMINDERS
// ============================================

let remindersWidgetConfig = null;
let currentReminderEdit = null;

function createRemindersWidget(config) {
  remindersWidgetConfig = config;

  const widget = document.createElement('div');
  widget.className = 'widget reminders-widget';
  widget.id = 'reminders-widget';

  widget.innerHTML = `
    <div class="reminders__header">
      <div class="reminders__title">Reminders</div>
      <div class="reminders__count" id="reminders-count">0</div>
    </div>
    <div class="reminders__list" id="reminders-list">
      <div class="reminders__loading">Loading...</div>
    </div>
    <button class="reminders__add-btn" id="reminders-add-btn" title="Add reminder">
      <svg class="icon icon--md"><use href="#icon-plus"/></svg>
    </button>
  `;

  // Setup add button handler
  setTimeout(() => {
    const addBtn = document.getElementById('reminders-add-btn');
    if (addBtn) {
      addBtn.addEventListener('click', () => openReminderModal());
    }
  }, 0);

  return widget;
}

async function fetchReminders() {
  const apiUrl = CONFIG.apis?.reminders;
  if (!apiUrl) {
    renderReminders([]);
    return;
  }

  try {
    const response = await fetch(apiUrl);
    if (!response.ok) throw new Error('Failed to fetch reminders');
    remindersCache = await response.json();
    renderReminders(remindersCache);
  } catch (error) {
    console.error('Error fetching reminders:', error);
    renderReminders([]);
  }
}

function renderReminders(reminders) {
  const listEl = document.getElementById('reminders-list');
  const countEl = document.getElementById('reminders-count');
  if (!listEl) return;

  const active = reminders.filter(r => !r.completed);
  const completed = reminders.filter(r => r.completed);

  // Update count
  if (countEl) {
    countEl.textContent = active.length;
  }

  if (reminders.length === 0) {
    listEl.innerHTML = `
      <div class="reminders__empty">
        <svg class="icon icon--xl"><use href="#icon-check-circle"/></svg>
        <div class="reminders__empty-text">No reminders</div>
      </div>
    `;
    return;
  }

  // Get current reminder IDs from new data
  const newIds = new Set(reminders.map(r => r.id));

  // SURGICAL UPDATE: Remove deleted items
  const existingItems = listEl.querySelectorAll('.reminder-item');
  existingItems.forEach(item => {
    const id = item.dataset.id;
    if (!newIds.has(id)) {
      item.remove();
      renderedReminderIds.delete(id);
    }
  });

  // SURGICAL UPDATE: Update or add items
  let hasChanges = false;

  [...active, ...completed].forEach((reminder, index) => {
    const existingItem = listEl.querySelector(`[data-id="${CSS.escape(reminder.id)}"]`);

    if (existingItem) {
      // UPDATE: Check if content changed
      if (needsUpdate(existingItem, reminder)) {
        const newItem = createReminderElement(reminder);
        existingItem.replaceWith(newItem);
        hasChanges = true;
      }
    } else {
      // ADD: New reminder
      const newItem = createReminderElement(reminder);

      // Find correct insertion point (maintain order)
      const allItems = Array.from(listEl.querySelectorAll('.reminder-item'));
      let insertBefore = null;
      for (let i = 0; i < allItems.length; i++) {
        const itemId = allItems[i].dataset.id;
        const itemIndex = reminders.findIndex(r => r.id === itemId);
        if (itemIndex > index) {
          insertBefore = allItems[i];
          break;
        }
      }

      if (insertBefore) {
        listEl.insertBefore(newItem, insertBefore);
      } else {
        listEl.appendChild(newItem);
      }

      renderedReminderIds.add(reminder.id);
      hasChanges = true;
    }
  });

  // Add section divider if needed
  const existingDivider = listEl.querySelector('.reminders__section-divider');
  if (completed.length > 0 && !existingDivider) {
    const divider = document.createElement('div');
    divider.className = 'reminders__section-divider';
    divider.textContent = 'Completed';

    // Insert before first completed item
    const firstCompleted = listEl.querySelector(`[data-id="${CSS.escape(completed[0].id)}"]`);
    if (firstCompleted) {
      listEl.insertBefore(divider, firstCompleted);
    }
  } else if (completed.length === 0 && existingDivider) {
    // Remove divider if no completed items
    existingDivider.remove();
  }

  if (hasChanges) {
    attachReminderListeners(); // Re-attach only if DOM changed
  }
}

function needsUpdate(element, reminder) {
  // Compare rendered content with new data
  const titleEl = element.querySelector('.reminder-item__title');
  const notesEl = element.querySelector('.reminder-item__notes');
  const dateEl = element.querySelector('.reminder-item__date');

  if (titleEl?.textContent !== reminder.title) return true;
  if ((notesEl?.textContent || '') !== (reminder.notes || '')) return true;
  if (element.classList.contains('reminder-item--completed') !== reminder.completed) return true;

  // Check date formatting
  if (reminder.dueDate) {
    const formattedDate = formatReminderDate(reminder.dueDate);
    if ((dateEl?.textContent || '') !== formattedDate) return true;
  } else if (dateEl) {
    return true; // Had date, now doesn't
  }

  return false;
}

function createReminderElement(reminder) {
  const item = document.createElement('div');
  item.className = 'reminder-item';
  if (reminder.completed) item.classList.add('reminder-item--completed');
  item.dataset.id = reminder.id;

  const checkbox = document.createElement('div');
  checkbox.className = 'reminder-item__checkbox';
  checkbox.dataset.action = 'toggle';
  checkbox.innerHTML = `
    <svg class="icon icon--md">
      <use href="#icon-${reminder.completed ? 'check-circle-filled' : 'circle'}"/>
    </svg>
  `;

  const content = document.createElement('div');
  content.className = 'reminder-item__content';
  content.dataset.action = 'edit';

  const title = document.createElement('div');
  title.className = 'reminder-item__title';
  title.textContent = reminder.title;
  content.appendChild(title);

  if (reminder.notes) {
    const notes = document.createElement('div');
    notes.className = 'reminder-item__notes';
    notes.textContent = reminder.notes;
    content.appendChild(notes);
  }

  if (reminder.dueDate) {
    const date = document.createElement('div');
    date.className = 'reminder-item__date';
    date.textContent = formatReminderDate(reminder.dueDate);
    content.appendChild(date);
  }

  item.appendChild(checkbox);
  item.appendChild(content);

  return item;
}

function attachReminderListeners() {
  document.querySelectorAll('.reminder-item').forEach(item => {
    const id = item.dataset.id;

    // Checkbox toggle
    const checkbox = item.querySelector('[data-action="toggle"]');
    if (checkbox) {
      checkbox.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleReminder(id);
      });
    }

    // Edit on text click
    const content = item.querySelector('[data-action="edit"]');
    if (content) {
      content.addEventListener('click', () => {
        const reminder = remindersCache.find(r => r.id === id);
        if (reminder) openReminderModal(reminder);
      });
    }
  });
}

async function toggleReminder(id) {
  const requestKey = `toggle:${id}`;

  // Prevent duplicate requests
  if (remindersPendingRequests.has(requestKey)) {
    console.log('Toggle already in progress for', id);
    return;
  }

  const apiUrl = CONFIG.apis?.reminders;
  if (!apiUrl) return;

  // Find reminder in cache
  const reminder = remindersCache.find(r => r.id === id);
  if (!reminder) return;

  // Optimistic update
  const originalState = reminder.completed;
  reminder.completed = !originalState;
  renderReminders(remindersCache);

  remindersPendingRequests.add(requestKey);

  try {
    const response = await fetch(`${apiUrl}/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed: !originalState })
    });

    if (!response.ok) throw new Error('Toggle failed');

    // Refresh from server to ensure sync
    await fetchReminders();
  } catch (error) {
    console.error('Error toggling reminder:', error);
    // Revert optimistic update
    reminder.completed = originalState;
    renderReminders(remindersCache);
  } finally {
    remindersPendingRequests.delete(requestKey);
  }
}

async function saveReminder(reminderData) {
  const apiUrl = CONFIG.apis?.reminders;
  if (!apiUrl) return false;

  try {
    const isNew = !reminderData.id;
    const url = isNew ? apiUrl : `${apiUrl}/${encodeURIComponent(reminderData.id)}`;
    const method = isNew ? 'POST' : 'PUT';

    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reminderData)
    });

    if (!response.ok) throw new Error('Save failed');

    fetchReminders();
    return true;
  } catch (error) {
    console.error('Error saving reminder:', error);
    return false;
  }
}

async function deleteReminder(id) {
  const apiUrl = CONFIG.apis?.reminders;
  if (!apiUrl) return;

  try {
    await fetch(`${apiUrl}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    fetchReminders();
  } catch (error) {
    console.error('Error deleting reminder:', error);
  }
}

function formatReminderDate(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const reminderDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const dayDiff = Math.floor((reminderDay - today) / (1000 * 60 * 60 * 24));

  let dateLabel = '';
  if (dayDiff === 0) dateLabel = 'Today';
  else if (dayDiff === 1) dateLabel = 'Tomorrow';
  else if (dayDiff === -1) dateLabel = 'Yesterday';
  else if (dayDiff > 1 && dayDiff <= 7) {
    // Show day of week for next week
    dateLabel = date.toLocaleDateString('en-US', { weekday: 'long' });
  } else {
    dateLabel = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  const timeStr = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

  return `${dateLabel}, ${timeStr}`;
}

function openReminderModal(reminder = null) {
  currentReminderEdit = reminder;

  const modal = document.getElementById('reminder-modal');
  const titleInput = document.getElementById('reminder-title-input');
  const notesInput = document.getElementById('reminder-notes-input');
  const dateInput = document.getElementById('reminder-date-input');
  const timeInput = document.getElementById('reminder-time-input');
  const deleteBtn = document.getElementById('reminder-delete-btn');
  const modalTitle = document.getElementById('reminder-modal-title');

  if (!modal) return;

  // Set modal title
  if (modalTitle) {
    modalTitle.textContent = reminder ? 'Edit Reminder' : 'New Reminder';
  }

  // Populate fields
  if (reminder) {
    if (titleInput) titleInput.value = reminder.title;
    if (notesInput) notesInput.value = reminder.notes || '';

    if (reminder.dueDate) {
      const date = new Date(reminder.dueDate);
      if (dateInput) dateInput.value = date.toISOString().split('T')[0];
      if (timeInput) timeInput.value = date.toTimeString().slice(0, 5);
    }

    if (deleteBtn) deleteBtn.style.display = 'block';
  } else {
    if (titleInput) titleInput.value = '';
    if (notesInput) notesInput.value = '';
    if (dateInput) dateInput.value = '';
    if (timeInput) timeInput.value = '';
    if (deleteBtn) deleteBtn.style.display = 'none';
  }

  modal.classList.add('active');

  // Focus title input
  setTimeout(() => titleInput?.focus(), 100);
}

function closeReminderModal() {
  const modal = document.getElementById('reminder-modal');
  if (modal) modal.classList.remove('active');
  currentReminderEdit = null;
}

function setupReminderModal() {
  const modal = document.getElementById('reminder-modal');
  const closeBtn = document.getElementById('reminder-close-btn');
  const saveBtn = document.getElementById('reminder-save-btn');
  const deleteBtn = document.getElementById('reminder-delete-btn');
  const cancelBtn = document.getElementById('reminder-cancel-btn');
  const backdrop = modal?.querySelector('.modal__backdrop');

  if (closeBtn) closeBtn.addEventListener('click', closeReminderModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeReminderModal);
  if (backdrop) backdrop.addEventListener('click', closeReminderModal);

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const titleInput = document.getElementById('reminder-title-input');
      const notesInput = document.getElementById('reminder-notes-input');
      const dateInput = document.getElementById('reminder-date-input');
      const timeInput = document.getElementById('reminder-time-input');

      const title = titleInput?.value.trim();
      if (!title) {
        alert('Please enter a title');
        return;
      }

      let dueDate = null;
      if (dateInput?.value) {
        // Combine date and time, or use default 9:00 AM if no time
        const timeValue = timeInput?.value || '09:00';
        dueDate = `${dateInput.value}T${timeValue}:00`;
      }

      const reminderData = {
        title,
        notes: notesInput?.value.trim() || '',
        dueDate
      };

      if (currentReminderEdit) {
        reminderData.id = currentReminderEdit.id;
      }

      if (await saveReminder(reminderData)) {
        closeReminderModal();
      }
    });
  }

  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      if (!currentReminderEdit) return;

      if (confirm('Delete this reminder?')) {
        await deleteReminder(currentReminderEdit.id);
        closeReminderModal();
      }
    });
  }
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

// setTextContent, setInnerHTML are defined in shared/core.js

function updateDate() {
  const options = { weekday: 'long', month: 'long', day: 'numeric' };
  const dateStr = new Date().toLocaleDateString('en-US', options);
  setTextContent('current-date', dateStr);
}

// ============================================
// SLEEP MODE
// ============================================

/**
 * Check if we're in sleep hours and pause/resume accordingly
 */
async function checkSleepHours() {
  const sleepConfig = CONFIG?.sleepHours;

  if (!sleepConfig || !sleepConfig.enabled) {
    // Sleep mode disabled
    if (isSleeping) {
      await resumeFromSleep();
    }
    applyDisplayState('normal');
    return;
  }

  try {
    const response = await fetch('http://192.168.1.137:8889/api/sleep/check');
    if (!response.ok) throw new Error('Sleep check failed');

    const status = await response.json();
    const newState = status.state || 'normal';

    // Apply CSS-based display state (dim overlay, sleep blackout)
    applyDisplayState(newState);

    // Only pause polling when display is off (sleep state)
    if (newState === 'sleep' && !isSleeping) {
      console.log('[Sleep] Entering sleep mode');
      await enterSleepMode();
    } else if (newState !== 'sleep' && isSleeping) {
      console.log('[Sleep] Exiting sleep mode');
      await resumeFromSleep();
    }
  } catch (error) {
    console.error('[Sleep] Error checking sleep hours:', error);
  }
}

/**
 * Apply CSS-based display state (normal, dim, sleep)
 */
function applyDisplayState(state) {
  if (state === currentDisplayState) return;

  // Remove all display state classes
  document.body.classList.remove('display--dim', 'display--sleep');

  // Apply new state
  if (state === 'dim') {
    document.body.classList.add('display--dim');
    console.log('[Sleep] Display dimmed via CSS');
  } else if (state === 'sleep') {
    document.body.classList.add('display--sleep');
    console.log('[Sleep] Display blacked out via CSS');
  } else {
    console.log('[Sleep] Display at normal brightness');
  }

  currentDisplayState = state;
}

/**
 * Enter sleep mode - pause all polling and turn off display
 */
async function enterSleepMode() {
  isSleeping = true;

  // Clear all polling intervals
  Object.keys(intervals).forEach(key => {
    if (intervals[key]) {
      clearInterval(intervals[key]);
      intervals[key] = null;
    }
  });

  // Close WebSocket connection
  if (notifySocket) {
    notifySocket.close();
    notifySocket = null;
  }

  console.log('[Sleep] All polling paused, WebSocket closed');
}

/**
 * Resume from sleep mode - restart all polling and turn on display
 */
async function resumeFromSleep() {
  isSleeping = false;

  // Refresh all data
  await Promise.all([
    fetchCalendar(),
    fetchWeather(),
    fetchNote(),
    fetchRecipe(),
    fetchShipments(),
    fetchNotifications(),
    fetchAllDevices().then(updateAllDeviceTiles),
  ]);

  // Restart polling intervals
  intervals.calendar = setInterval(fetchCalendar, 21600000);
  intervals.weather = setInterval(fetchWeather, 1800000);
  intervals.note = setInterval(fetchNote, 30000);
  intervals.recipe = setInterval(fetchRecipe, 3600000);
  intervals.devices = setInterval(() => {
    fetchAllDevices().then(updateAllDeviceTiles);
  }, 10000);
  intervals.shipping = setInterval(fetchShipments, 300000);
  intervals.notifications = setInterval(fetchNotifications, 300000);

  // Reconnect WebSocket
  connectNotifyWebSocket();

  console.log('[Sleep] Resumed all polling and WebSocket');
}

// ============================================
// INITIALIZATION
// ============================================

async function init() {
  try {
    // 1. Load config first (using shared/core.js loadConfig)
    await loadConfig('config.json');

    // Ensure layout has defaults if not configured
    if (!CONFIG.layout) {
      CONFIG.layout = {
        topRow: { tiles: [] },
        middleRow: { columns: [1, 1, 1, 1], tiles: [] },
        bottomRow: { columns: [1, 1, 1, 1], tiles: [] }
      };
    }

    // 2. Apply config to header
    setTextContent('home-title', CONFIG.home?.title || 'Home Dashboard');
    updateDate();

    // 3. Render layout based on config
    renderLayout();

    // 4. Set up modals
    setupBrightnessSlider();
    setupNoteModal();
    setupQRModal();
    setupReminderModal();

    // 5. Initialize all widgets in parallel
    await Promise.all([
      fetchCalendar(),
      fetchWeather(),
      fetchNote(),
      fetchRecipe(),
      fetchShipments(),
      fetchNotifications(),
      fetchReminders(),
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
    intervals.reminders = setInterval(fetchReminders, 30000);    // 30 sec

    // 7. Update date hourly
    setInterval(updateDate, 3600000);

    // 8. Connect WebSocket for real-time notifications
    connectNotifyWebSocket();

    // 9. Start sleep hours checker (runs every minute)
    sleepCheckInterval = setInterval(checkSleepHours, 60000);
    checkSleepHours(); // Check immediately

    console.log('Skylight Home v2 initialized');
  } catch (error) {
    console.error('Initialization error:', error);
  }
}

// Start when DOM is ready
document.addEventListener('DOMContentLoaded', init);
