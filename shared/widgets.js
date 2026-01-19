/**
 * Skylight Home - Shared Widgets
 *
 * Widget pool shared between dashboard and mobile apps.
 * Each widget has:
 * - fetch function: Gets data from APIs
 * - render function: Renders IDENTICAL HTML to both interfaces
 * - state: Cached data
 *
 * CSS handles responsive differences via container queries.
 */

'use strict';

// ============================================
// WIDGET STATE (Shared Cache)
// ============================================

const WidgetState = {
  weather: null,
  notifications: [],
  shipments: [],
  recipe: null
};

// ============================================
// WEATHER WIDGET
// ============================================

const WeatherWidget = {
  state: null,

  async fetch(config = {}) {
    const weatherConfig = config.weather || CONFIG?.weather || {};
    const lat = weatherConfig.latitude || 34.67;
    const lon = weatherConfig.longitude || -86.50;
    const tz = weatherConfig.timezone || 'America/Chicago';
    const location = weatherConfig.location || 'Unknown';
    const forecastDays = config.forecastDays || 4;
    const conditions = config.conditions || ['humidity', 'wind', 'precip'];

    // Build API URL
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

      this.state = {
        current: data.current,
        daily: data.daily,
        location,
        conditions,
        forecastDays
      };

      WidgetState.weather = this.state;
      return this.state;
    } catch (error) {
      console.error('Error fetching weather:', error);
      return null;
    }
  },

  render(container, config = {}) {
    if (!container || !this.state) return;

    const { current, daily, location, conditions, forecastDays } = this.state;
    const weatherInfo = getWeatherInfo(current.weather_code);

    const temp = Math.round(current.temperature_2m);
    const feelsLike = Math.round(current.apparent_temperature);
    const high = Math.round(daily.temperature_2m_max[0]);
    const low = Math.round(daily.temperature_2m_min[0]);

    // Condition types with labels
    const CONDITION_TYPES = {
      humidity: { label: 'Humidity', unit: '%' },
      wind: { label: 'Wind', unit: ' mph' },
      precip: { label: 'Precip', unit: '%' },
      uv: { label: 'UV Index', unit: '' },
      feelsLike: { label: 'Feels Like', unit: '°' },
      visibility: { label: 'Visibility', unit: ' mi' },
      pressure: { label: 'Pressure', unit: ' hPa' },
    };

    // Build conditions HTML
    const conditionsHtml = conditions.map(cond => {
      const info = CONDITION_TYPES[cond] || { label: cond, unit: '' };
      let value = '--';
      switch (cond) {
        case 'humidity': value = (current.relative_humidity_2m || 0) + info.unit; break;
        case 'wind': value = Math.round(current.wind_speed_10m || 0) + info.unit; break;
        case 'precip': value = (daily.precipitation_probability_max[0] || 0) + info.unit; break;
        case 'uv': value = Math.round(current.uv_index || 0) + info.unit; break;
        case 'feelsLike': value = Math.round(current.apparent_temperature || 0) + info.unit; break;
        case 'visibility': value = Math.round((current.visibility || 0) / 1609.34) + info.unit; break;
        case 'pressure': value = Math.round(current.surface_pressure || 0) + info.unit; break;
      }
      return `
        <div class="weather-widget__stat">
          <div class="weather-widget__stat-value">${value}</div>
          <div class="weather-widget__stat-label">${info.label}</div>
        </div>
      `;
    }).join('');

    // Calculate temp range for bars
    const allTemps = [...daily.temperature_2m_max, ...daily.temperature_2m_min];
    const minTemp = Math.min(...allTemps);
    const maxTemp = Math.max(...allTemps);
    const tempRange = maxTemp - minTemp || 1;

    // Build forecast HTML
    const forecastHtml = daily.time.slice(0, forecastDays).map((date, i) => {
      const dayInfo = getWeatherInfo(daily.weather_code[i]);
      const dayLow = Math.round(daily.temperature_2m_min[i]);
      const dayHigh = Math.round(daily.temperature_2m_max[i]);
      const precip = daily.precipitation_probability_max[i] || 0;
      const barLeft = ((dayLow - minTemp) / tempRange) * 100;
      const barWidth = ((dayHigh - dayLow) / tempRange) * 100;

      return `
        <div class="weather-widget__day ${i === 0 ? 'weather-widget__day--today' : ''}">
          <span class="weather-widget__day-name">${getDayName(date, i)}</span>
          <svg class="weather-widget__day-icon"><use href="#${dayInfo.icon}"/></svg>
          <span class="weather-widget__day-precip">${precip > 0 ? precip + '%' : ''}</span>
          <div class="weather-widget__day-temps">
            <span class="weather-widget__day-low">${dayLow}°</span>
            <div class="weather-widget__day-bar">
              <div class="weather-widget__day-bar-fill" style="left: ${barLeft}%; width: ${barWidth}%;"></div>
            </div>
            <span class="weather-widget__day-high">${dayHigh}°</span>
          </div>
        </div>
      `;
    }).join('');

    const gridCols = Math.min(conditions.length, 4);

    // Unified HTML structure - CSS handles responsive layout
    container.innerHTML = `
      <div class="weather-widget">
        <div class="weather-widget__header">
          <div class="weather-widget__main">
            <svg class="weather-widget__icon"><use href="#${weatherInfo.icon}"/></svg>
            <div class="weather-widget__temp-group">
              <span class="weather-widget__temp">${temp}</span>
              <span class="weather-widget__temp-unit">°</span>
            </div>
          </div>
          <div class="weather-widget__info">
            <div class="weather-widget__desc">${weatherInfo.desc}</div>
            <div class="weather-widget__meta">
              <span class="weather-widget__location">${location}</span>
              <span class="weather-widget__range">${high}° / ${low}°</span>
            </div>
            <div class="weather-widget__feels">Feels like ${feelsLike}°</div>
          </div>
        </div>
        <div class="weather-widget__conditions">
          <div class="weather-widget__section-title">Conditions</div>
          <div class="weather-widget__stats" style="--grid-cols: ${gridCols};">
            ${conditionsHtml}
          </div>
        </div>
        <div class="weather-widget__forecast">
          <div class="weather-widget__section-title">This Week</div>
          <div class="weather-widget__days ${forecastDays > 4 ? 'weather-widget__days--scrollable' : ''}">
            ${forecastHtml}
          </div>
        </div>
      </div>
    `;
  }
};

// ============================================
// NOTIFICATIONS WIDGET
// ============================================

const NotificationsWidget = {
  state: [],

  async fetch(config = {}) {
    const apiUrl = config.apiUrl || CONFIG?.apis?.notifications;
    if (!apiUrl) {
      this.state = [];
      WidgetState.notifications = [];
      return [];
    }

    try {
      const response = await fetch(apiUrl);
      if (!response.ok) throw new Error('Failed to fetch notifications');
      this.state = await response.json();
      WidgetState.notifications = this.state;
      return this.state;
    } catch (error) {
      console.error('Error fetching notifications:', error);
      this.state = [];
      WidgetState.notifications = [];
      return [];
    }
  },

  render(container) {
    if (!container) return;

    const notifications = this.state;

    const getIcon = (icon) => {
      const iconMap = {
        'alert': '#icon-alert',
        'star': '#icon-star',
        'clock': '#icon-clock',
        'check-circle': '#icon-check-circle'
      };
      return iconMap[icon] || '#icon-alert';
    };

    if (notifications.length === 0) {
      // Calm state - "All Clear"
      container.innerHTML = `
        <div class="notify-widget notify-widget--calm">
          <div class="notify-widget__header">
            <div class="notify-widget__dot"></div>
            <span class="notify-widget__status">All Clear</span>
            <span class="notify-widget__timestamp">Updated just now</span>
          </div>
          <div class="notify-widget__calm-state">
            <svg class="notify-widget__calm-icon"><use href="#icon-check-circle"/></svg>
            <div class="notify-widget__calm-text">No alerts or reminders</div>
            <div class="notify-widget__calm-subtext">Enjoy your day</div>
          </div>
        </div>
      `;
      return;
    }

    const hasUrgent = notifications.some(n => n.priority === 'urgent');
    const hasNormal = notifications.some(n => n.priority === 'normal');
    const statusText = hasUrgent ? 'Alerts' : hasNormal ? 'Notices' : 'Info';
    const dotClass = hasUrgent ? 'notify-widget__dot--urgent' :
                     hasNormal ? 'notify-widget__dot--normal' : 'notify-widget__dot--info';

    const visibleAlerts = notifications.slice(0, 2);
    const isSingle = visibleAlerts.length === 1;

    const alertsHtml = visibleAlerts.map(n => {
      const alertClass = n.priority === 'urgent' ? 'notify-widget__alert--urgent' :
                         n.priority === 'normal' ? 'notify-widget__alert--normal' : 'notify-widget__alert--info';
      return `
        <div class="notify-widget__alert ${alertClass}" data-notification-id="${n.id}">
          <svg class="notify-widget__alert-icon"><use href="${getIcon(n.icon)}"/></svg>
          <div class="notify-widget__alert-text">
            <div class="notify-widget__alert-title">${n.title}</div>
            ${n.message ? `<div class="notify-widget__alert-message">${n.message}</div>` : ''}
          </div>
          ${!n.recurring ? `
            <button class="notify-widget__dismiss" data-id="${n.id}" title="Dismiss">
              <svg class="notify-widget__dismiss-icon"><use href="#icon-x"/></svg>
            </button>
          ` : ''}
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div class="notify-widget notify-widget--alerts">
        <div class="notify-widget__header">
          <div class="notify-widget__dot ${dotClass}"></div>
          <span class="notify-widget__status">${statusText}</span>
          <span class="notify-widget__timestamp">Updated just now</span>
        </div>
        <div class="notify-widget__content ${isSingle ? '' : 'notify-widget__content--dual'}">
          ${alertsHtml}
        </div>
      </div>
    `;
  }
};

// ============================================
// SHIPPING WIDGET
// ============================================

const ShippingWidget = {
  state: [],

  // Status and carrier mappings
  STATUS_MAP: {
    'Pending': { class: 'badge--pending', label: 'Pending' },
    'InfoReceived': { class: 'badge--info', label: 'Label Created' },
    'InTransit': { class: 'badge--warning', label: 'In Transit' },
    'OutForDelivery': { class: 'badge--alert', label: 'Out for Delivery' },
    'AttemptFail': { class: 'badge--error', label: 'Failed Attempt' },
    'Delivered': { class: 'badge--success', label: 'Delivered' },
    'AvailableForPickup': { class: 'badge--info', label: 'Ready for Pickup' },
    'Exception': { class: 'badge--error', label: 'Exception' },
    'Expired': { class: 'badge--error', label: 'Expired' }
  },

  CARRIER_MAP: {
    'ups': { label: 'UPS' },
    'fedex': { label: 'FDX' },
    'usps': { label: 'USPS' },
    'dhl': { label: 'DHL' },
    'amazon': { label: 'AMZ' },
    'amazon-fba-us': { label: 'AMZ' },
  },

  async fetch(config = {}) {
    const apiKey = config.apiKey || CONFIG?.apis?.aftership_key;
    const apiUrl = config.apiUrl || CONFIG?.apis?.aftership;

    if (!apiKey || !apiUrl) {
      this.state = [];
      WidgetState.shipments = [];
      return [];
    }

    try {
      const response = await fetch(apiUrl, {
        headers: { 'aftership-api-key': apiKey }
      });
      if (!response.ok) throw new Error('Failed to fetch shipments');
      const data = await response.json();
      this.state = data.data?.trackings || [];
      WidgetState.shipments = this.state;
      return this.state;
    } catch (error) {
      console.error('Error fetching shipments:', error);
      this.state = [];
      WidgetState.shipments = [];
      return [];
    }
  },

  formatEta(expectedDelivery) {
    if (!expectedDelivery) return '--';
    const date = new Date(expectedDelivery);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  },

  getStatusInfo(tag) {
    return this.STATUS_MAP[tag] || { class: 'badge--pending', label: tag };
  },

  getCarrierInfo(slug) {
    return this.CARRIER_MAP[slug] || { label: 'PKG' };
  },

  render(container, config = {}) {
    if (!container) return;

    const active = this.state.filter(t => t.tag !== 'Delivered');
    const maxItems = config.maxItems || 5;

    if (active.length === 0) {
      container.innerHTML = `
        <div class="shipping-widget shipping-widget--empty">
          <div class="shipping-widget__header">
            <span class="shipping-widget__title">Incoming Packages</span>
            <span class="shipping-widget__count">0 active</span>
          </div>
          <div class="shipping-widget__empty">No packages to track</div>
        </div>
      `;
      return;
    }

    const visiblePackages = active.slice(0, maxItems);
    const packagesHtml = visiblePackages.map((tracking, index) => {
      const carrier = this.getCarrierInfo(tracking.slug);
      const status = this.getStatusInfo(tracking.tag);
      const eta = this.formatEta(tracking.expected_delivery);
      const isToday = eta === 'Today';
      const isOut = tracking.tag === 'OutForDelivery';

      return `
        <div class="shipping-widget__package" data-tracking-index="${index}">
          <div class="shipping-widget__carrier shipping-widget__carrier--${tracking.slug}">${carrier.label}</div>
          <div class="shipping-widget__info">
            <div class="shipping-widget__name">${tracking.title || 'Package'}</div>
            <div class="shipping-widget__status ${isOut ? 'shipping-widget__status--out' : ''}">${status.label}</div>
          </div>
          <div class="shipping-widget__eta ${isToday ? 'shipping-widget__eta--today' : ''}">${eta}</div>
          <svg class="shipping-widget__chevron"><use href="#icon-chevron"/></svg>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div class="shipping-widget">
        <div class="shipping-widget__header">
          <span class="shipping-widget__title">Incoming Packages</span>
          <span class="shipping-widget__count">${active.length} active</span>
        </div>
        <div class="shipping-widget__list">
          ${packagesHtml}
        </div>
      </div>
    `;
  },

  // Get tracking by index for detail view
  getTracking(index) {
    const active = this.state.filter(t => t.tag !== 'Delivered');
    return active[index];
  }
};

// ============================================
// EXPORTS (for global access)
// ============================================

// Make widgets globally available
window.WidgetState = WidgetState;
window.WeatherWidget = WeatherWidget;
window.NotificationsWidget = NotificationsWidget;
window.ShippingWidget = ShippingWidget;
