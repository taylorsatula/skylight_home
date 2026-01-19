/**
 * Skylight Home - Shared Core Module
 *
 * Common utilities shared between dashboard and mobile PWA:
 * - Config loading
 * - Home Assistant API
 * - Weather data utilities
 * - DOM helpers
 */

'use strict';

// ============================================
// GLOBAL CONFIG
// ============================================

let CONFIG = null;

/**
 * Load configuration from a JSON file
 * @param {string} path - Path to config file (default: 'config.json')
 * @returns {Promise<object>} Configuration object
 */
async function loadConfig(path = 'config.json') {
  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error('Config fetch failed');
    CONFIG = await response.json();
    return CONFIG;
  } catch (error) {
    console.error(`Failed to load ${path}:`, error);
    // Return minimal defaults
    CONFIG = {
      weather: { latitude: 34.67, longitude: -86.50, timezone: 'America/Chicago', location: 'Unknown' },
      apis: {},
      home: { title: 'Home Dashboard' },
      homeAssistant: {}
    };
    return CONFIG;
  }
}

/**
 * Get current config (for modules that import after config is loaded)
 */
function getConfig() {
  return CONFIG;
}

/**
 * Set config directly (useful for mobile app with different config)
 */
function setConfig(config) {
  CONFIG = config;
}

// ============================================
// HOME ASSISTANT API
// ============================================

/**
 * Make authenticated request to Home Assistant API
 * @param {string} endpoint - API endpoint (e.g., '/api/states/light.lamp')
 * @param {object} options - Fetch options
 * @param {object} haConfig - Optional HA config override { url, token }
 * @returns {Promise<object>} Response JSON
 */
async function haFetch(endpoint, options = {}, haConfig = null) {
  const config = haConfig || CONFIG?.homeAssistant || {};
  const url = config.url || 'http://192.168.1.137:8123';
  const token = config.token || '';

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
 * @param {string} entityId - Entity ID (e.g., 'light.bedroom')
 * @param {object} haConfig - Optional HA config override
 * @returns {Promise<object>} Device state
 */
async function fetchDeviceState(entityId, haConfig = null) {
  const state = await haFetch(`/api/states/${entityId}`, {}, haConfig);
  return {
    entity_id: entityId,
    state: state.state,
    is_on: state.state === 'on',
    attributes: state.attributes,
    brightness: state.attributes.brightness !== undefined
      ? Math.round((state.attributes.brightness / 255) * 100)
      : undefined,
    color_temp: state.attributes.color_temp,
    rgb_color: state.attributes.rgb_color,
    hs_color: state.attributes.hs_color
  };
}

/**
 * Turn device on
 * @param {string} entityId - Entity ID
 * @param {string} domain - Domain (light, switch)
 * @param {object} haConfig - Optional HA config override
 */
async function turnOn(entityId, domain = 'light', haConfig = null) {
  return haFetch(`/api/services/${domain}/turn_on`, {
    method: 'POST',
    body: JSON.stringify({ entity_id: entityId })
  }, haConfig);
}

/**
 * Turn device off
 * @param {string} entityId - Entity ID
 * @param {string} domain - Domain (light, switch)
 * @param {object} haConfig - Optional HA config override
 */
async function turnOff(entityId, domain = 'light', haConfig = null) {
  return haFetch(`/api/services/${domain}/turn_off`, {
    method: 'POST',
    body: JSON.stringify({ entity_id: entityId })
  }, haConfig);
}

/**
 * Set brightness for a light (0-100)
 * @param {string} entityId - Entity ID
 * @param {number} brightness - Brightness percentage (0-100)
 * @param {object} haConfig - Optional HA config override
 */
async function setBrightness(entityId, brightness, haConfig = null) {
  return haFetch('/api/services/light/turn_on', {
    method: 'POST',
    body: JSON.stringify({
      entity_id: entityId,
      brightness_pct: parseInt(brightness)
    })
  }, haConfig);
}

/**
 * Set light RGB color
 * @param {string} entityId - Entity ID
 * @param {number[]} rgb - RGB array [r, g, b] (0-255 each)
 * @param {object} haConfig - Optional HA config override
 */
async function setLightColor(entityId, rgb, haConfig = null) {
  return haFetch('/api/services/light/turn_on', {
    method: 'POST',
    body: JSON.stringify({
      entity_id: entityId,
      rgb_color: rgb
    })
  }, haConfig);
}

/**
 * Set light color temperature
 * @param {string} entityId - Entity ID
 * @param {number} mireds - Color temperature in mireds (153-500 typical)
 * @param {object} haConfig - Optional HA config override
 */
async function setColorTemp(entityId, mireds, haConfig = null) {
  return haFetch('/api/services/light/turn_on', {
    method: 'POST',
    body: JSON.stringify({
      entity_id: entityId,
      color_temp: mireds
    })
  }, haConfig);
}

/**
 * Set light HS color (hue/saturation)
 * @param {string} entityId - Entity ID
 * @param {number} hue - Hue (0-360)
 * @param {number} saturation - Saturation (0-100)
 * @param {object} haConfig - Optional HA config override
 */
async function setLightHS(entityId, hue, saturation, haConfig = null) {
  return haFetch('/api/services/light/turn_on', {
    method: 'POST',
    body: JSON.stringify({
      entity_id: entityId,
      hs_color: [hue, saturation]
    })
  }, haConfig);
}

// ============================================
// WEATHER UTILITIES
// ============================================

/**
 * Weather code to icon/description mapping (Open-Meteo)
 */
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

/**
 * Get weather icon and description from code
 * @param {number} code - Open-Meteo weather code
 * @returns {{ icon: string, desc: string }}
 */
function getWeatherInfo(code) {
  return WEATHER_CODES[code] || { icon: 'weather-sun', desc: 'Unknown' };
}

/**
 * Get day name for forecast display
 * @param {string} dateStr - ISO date string (YYYY-MM-DD)
 * @param {number} index - Day index (0 = today)
 * @returns {string} Day name
 */
function getDayName(dateStr, index) {
  if (index === 0) return 'Today';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { weekday: 'short' });
}

// ============================================
// WEBSOCKET UTILITIES
// ============================================

/**
 * Create a reconnecting WebSocket connection
 * @param {string} url - WebSocket URL
 * @param {function} onMessage - Message handler (receives parsed JSON)
 * @param {function} onConnect - Connection handler
 * @param {number} reconnectDelay - Delay before reconnect (ms)
 * @returns {{ socket: WebSocket|null, close: function }}
 */
function createWebSocket(url, onMessage, onConnect = null, reconnectDelay = 5000) {
  let socket = null;
  let shouldReconnect = true;

  function connect() {
    try {
      socket = new WebSocket(url);

      socket.onopen = () => {
        console.log(`[WebSocket] Connected to ${url}`);
        if (onConnect) onConnect(socket);
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          onMessage(data, socket);
        } catch (e) {
          console.error('[WebSocket] Parse error:', e);
        }
      };

      socket.onclose = () => {
        console.log('[WebSocket] Disconnected');
        socket = null;
        if (shouldReconnect) {
          console.log(`[WebSocket] Reconnecting in ${reconnectDelay / 1000}s...`);
          setTimeout(connect, reconnectDelay);
        }
      };

      socket.onerror = (err) => {
        console.error('[WebSocket] Error:', err);
      };
    } catch (e) {
      console.error('[WebSocket] Failed to connect:', e);
      if (shouldReconnect) {
        setTimeout(connect, reconnectDelay);
      }
    }
  }

  connect();

  return {
    get socket() { return socket; },
    close() {
      shouldReconnect = false;
      if (socket) {
        socket.close();
        socket = null;
      }
    },
    reconnect() {
      shouldReconnect = true;
      if (!socket) {
        connect();
      }
    }
  };
}

// ============================================
// DOM UTILITIES
// ============================================

/**
 * Safely set text content of an element by ID
 * @param {string} id - Element ID
 * @param {string} text - Text content
 */
function setTextContent(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/**
 * Safely set innerHTML of an element by ID
 * @param {string} id - Element ID
 * @param {string} html - HTML content
 */
function setInnerHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

// ============================================
// COLOR UTILITIES (for mobile color picker)
// ============================================

/**
 * Convert hex color to RGB array
 * @param {string} hex - Hex color (with or without #)
 * @returns {number[]} RGB array [r, g, b]
 */
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? [
    parseInt(result[1], 16),
    parseInt(result[2], 16),
    parseInt(result[3], 16)
  ] : [255, 255, 255];
}

/**
 * Convert RGB array to hex color
 * @param {number[]} rgb - RGB array [r, g, b]
 * @returns {string} Hex color with #
 */
function rgbToHex(rgb) {
  return '#' + rgb.map(x => {
    const hex = Math.max(0, Math.min(255, Math.round(x))).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

/**
 * Convert HSL to RGB
 * @param {number} h - Hue (0-360)
 * @param {number} s - Saturation (0-100)
 * @param {number} l - Lightness (0-100)
 * @returns {number[]} RGB array [r, g, b]
 */
function hslToRgb(h, s, l) {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/**
 * Convert RGB to HSL
 * @param {number} r - Red (0-255)
 * @param {number} g - Green (0-255)
 * @param {number} b - Blue (0-255)
 * @returns {{ h: number, s: number, l: number }} HSL values
 */
function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h, s;
  const l = (max + min) / 2;

  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }

  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/**
 * Convert color temperature (Kelvin) to RGB
 * @param {number} kelvin - Color temperature (1000-40000)
 * @returns {number[]} RGB array [r, g, b]
 */
function kelvinToRgb(kelvin) {
  const temp = kelvin / 100;
  let r, g, b;

  if (temp <= 66) {
    r = 255;
    g = Math.max(0, Math.min(255, 99.4708025861 * Math.log(temp) - 161.1195681661));
  } else {
    r = Math.max(0, Math.min(255, 329.698727446 * Math.pow(temp - 60, -0.1332047592)));
    g = Math.max(0, Math.min(255, 288.1221695283 * Math.pow(temp - 60, -0.0755148492)));
  }

  if (temp >= 66) {
    b = 255;
  } else if (temp <= 19) {
    b = 0;
  } else {
    b = Math.max(0, Math.min(255, 138.5177312231 * Math.log(temp - 10) - 305.0447927307));
  }

  return [Math.round(r), Math.round(g), Math.round(b)];
}

/**
 * Convert mireds to Kelvin
 * @param {number} mireds - Color temperature in mireds
 * @returns {number} Temperature in Kelvin
 */
function miredsToKelvin(mireds) {
  return Math.round(1000000 / mireds);
}

/**
 * Convert Kelvin to mireds
 * @param {number} kelvin - Color temperature in Kelvin
 * @returns {number} Temperature in mireds
 */
function kelvinToMireds(kelvin) {
  return Math.round(1000000 / kelvin);
}
