// ============================================
// SKYLIGHT HOME v3
// Calmscreen + Interrupt + Dock
// ============================================

// --- Config ---
// No static config needed — dock devices come from HA backend.

// --- Live data (fetched from backend) ---
let photoUrls = [];
let movieData = null;
let memoData = null;
let listItems = [];
let weatherData = null;
let displayOverride = null;  // Manual override from admin; cleared on schedule change
let haDevices = [];           // Home Assistant devices (dock + HA screen)
let haScenes = [];            // Home Assistant scenes (fetched from backend)

// --- Schedule ---
// Rules evaluated top-to-bottom; first match wins. Default: photo.
// days: array of JS day-of-week (0=Sun … 6=Sat). Omit to match all days.
// start/end: "HH:MM" in 24h. Range is inclusive start, exclusive end.
const SCHEDULE = [
  // Morning weather — every day 7:00–9:30
  { type: 'weather', start: '07:00', end: '09:30' },
  // Tuesday trash night — Tue 5:00pm–midnight
  { type: 'trash', days: [2], start: '17:00', end: '23:59' },
  // Wednesday movie night — Wed 7:30pm–11:00pm
  { type: 'movie', days: [3], start: '19:30', end: '23:00' },
  // Thursday movie night — Thu 5:00pm–11:00pm
  { type: 'movie', days: [4], start: '17:00', end: '23:00' },
];

function getScheduledScreen() {
  // Manual override takes precedence
  if (displayOverride) return displayOverride;

  const now = new Date();
  const day = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();

  for (const rule of SCHEDULE) {
    if (rule.days && !rule.days.includes(day)) continue;
    const [sh, sm] = rule.start.split(':').map(Number);
    const [eh, em] = rule.end.split(':').map(Number);
    if (minutes >= sh * 60 + sm && minutes < eh * 60 + em) return rule.type;
  }
  return 'photo';
}

function getScheduleSlot() {
  // Return a string key identifying the current schedule time slot.
  // Used to detect when we've crossed into a new slot.
  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();
  const minute = now.getMinutes();
  // Round down to nearest 30-min block for slot detection
  const slot = Math.floor(minute / 30);
  return `${day}-${hour}-${slot}`;
}

function renderScreen(type) {
  switch (type) {
    case 'weather':
      if (weatherData) showWeather(weatherData);
      else showPhoto();
      break;
    case 'movie':
      if (movieData) showMovie();
      else showEmptyState('movie');
      break;
    case 'memo':
      if (memoData) showMemo(memoData.title, memoData.content);
      else showEmptyState('memo');
      break;
    case 'list':
      if (listItems.length) showList(listItems.map(i => i.text));
      else showEmptyState('list');
      break;
    case 'ha':
      if (haDevices.length) showHA();
      else showEmptyState('ha');
      break;
    case 'trash':
      showTrashNight();
      break;
    default:
      showPhoto();
  }
}

function showScheduledScreen() {
  renderScreen(getScheduledScreen());
}

async function fetchDashboardData() {
  try {
    const [photosRes, movieRes, memoRes, listRes, overrideRes, devicesRes, scenesRes] = await Promise.all([
      fetch('/api/photos').then(r => r.ok ? r.json() : []).catch(() => []),
      fetch('/api/movie').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/memo').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/list-items').then(r => r.ok ? r.json() : []).catch(() => []),
      fetch('/api/display-override').then(r => r.ok ? r.json() : {}).catch(() => ({})),
      fetch('/api/ha/devices').then(r => r.ok ? r.json() : []).catch(() => []),
      fetch('/api/ha/scenes').then(r => r.ok ? r.json() : []).catch(() => []),
    ]);

    photoUrls = photosRes.map(p => `/photos/${p.filename}`);
    movieData = movieRes;
    memoData = memoRes;
    listItems = listRes;
    displayOverride = overrideRes.screen || null;
    haDevices = devicesRes;
    haScenes = scenesRes;
  } catch (err) {
    console.error('Failed to fetch dashboard data:', err);
    showError();
  }
}

// --- Weather (Open-Meteo, no API key needed) ---
const WMO_CODES = {
  0: 'Clear', 1: 'Mainly Clear', 2: 'Partly Cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Rime Fog',
  51: 'Light Drizzle', 53: 'Drizzle', 55: 'Dense Drizzle',
  61: 'Light Rain', 63: 'Rain', 65: 'Heavy Rain',
  71: 'Light Snow', 73: 'Snow', 75: 'Heavy Snow',
  80: 'Showers', 81: 'Moderate Showers', 82: 'Heavy Showers',
  95: 'Thunderstorm', 96: 'Thunderstorm + Hail', 99: 'Severe Thunderstorm',
};

// WMO weather code → icon file (see /weather-icons/).
// Night variants only for clear skies; other conditions look the same day/night.
const WEATHER_ICONS = {
  0:  '039-sun.png',       // Clear
  1:  '015-day.png',       // Mainly clear
  2:  '011-cloudy.png',    // Partly cloudy
  3:  '034-cloudy-1.png',  // Overcast
  45: '017-foog.png',      // Fog
  48: '017-foog.png',      // Rime fog
  51: '003-rainy.png',     // Light drizzle
  53: '003-rainy.png',     // Drizzle
  55: '004-rainy-1.png',   // Dense drizzle
  61: '003-rainy.png',     // Light rain
  63: '003-rainy.png',     // Rain
  65: '016-flood.png',     // Heavy rain
  71: '006-snowy.png',     // Light snow
  73: '006-snowy.png',     // Snow
  75: '012-snowy-1.png',   // Heavy snow
  77: '031-snowflake.png', // Snow grains
  80: '003-rainy.png',     // Showers
  81: '003-rainy.png',     // Moderate showers
  82: '004-rainy-1.png',   // Heavy showers
  85: '006-snowy.png',     // Snow showers
  86: '012-snowy-1.png',   // Heavy snow showers
  95: '008-storm.png',     // Thunderstorm
  96: '005-hail.png',      // Thunderstorm + hail
  99: '013-storm-2.png',   // Severe thunderstorm
};

const WEATHER_ICONS_NIGHT = {
  0: '032-star.png',  // Clear night
  1: '032-star.png',  // Mainly clear night
};

function weatherIconForCode(code, isDay = true) {
  const file = (!isDay && WEATHER_ICONS_NIGHT[code])
    ? WEATHER_ICONS_NIGHT[code]
    : (WEATHER_ICONS[code] || '039-sun.png');
  return `<img class="weather-interrupt__icon-img" src="/weather-icons/${file}" alt="" />`;
}

async function fetchWeather() {
  try {
    // Owens Cross Roads, AL
    const res = await fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=34.2444&longitude=-86.7589'
      + '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,is_day'
      + '&daily=temperature_2m_max,temperature_2m_min'
      + '&timezone=America%2FChicago&temperature_unit=fahrenheit',
      { cache: 'no-cache' },
    );
    if (!res.ok) return;

    const data = await res.json();
    const c = data.current;
    const d = data.daily;

    const temp = Math.round(c.temperature_2m);
    const high = Math.round(d.temperature_2m_max[0]);
    const low = Math.round(d.temperature_2m_min[0]);
    const range = high - low;
    const nowPct = range > 0 ? Math.max(0, Math.min(100, Math.round((temp - low) / range * 100))) : 50;

    weatherData = {
      temp,
      feelsLike: Math.round(c.apparent_temperature),
      condition: WMO_CODES[c.weather_code] || 'Unknown',
      icon: weatherIconForCode(c.weather_code, c.is_day === 1),
      high,
      low,
      unit: '°F',
      nowPct,
      humidity: c.relative_humidity_2m,
      windSpeed: Math.round(c.wind_speed_10m * 0.621371), // km/h → mph
    };
  } catch (err) {
    console.error('Fetch weather error:', err);
  }
}

// --- Trash Night Interrupt ---
function showTrashNight() {
  const today = new Date().toISOString().slice(0, 10);
  if (trashDismissedDate === today) {
    renderScreen('photo');
    return;
  }
  showInterrupt({
    type: 'trash',
    title: 'Trash Night',
    message: 'Don\'t forget to take out the trash tonight.',
    meta: 'Dismiss when done',
    icon: ICONS.trash,
    priority: 'urgent',
  });
}

// --- Error State ---
function showError() {
  const el = document.querySelector('.interrupt');
  const content = document.getElementById('interrupt-content');

  content.innerHTML = `
    <div class="screen">
      <div class="memo">
        <h2 class="memo__title">Connection Lost</h2>
        <p class="memo__text">Unable to reach the backend. The page will retry automatically.</p>
      </div>
    </div>
  `;

  el.classList.add('interrupt--active', 'interrupt--no-dismiss');
  currentInterrupt = { type: 'error' };
}

const EMPTY_STATE_LABELS = {
  movie: 'No movie selected',
  memo: 'No memo set',
  list: 'No items on the list',
  ha: 'No Home Assistant devices favorited',
};

function showEmptyState(type) {
  const label = EMPTY_STATE_LABELS[type] || 'Nothing here yet';
  const el = document.querySelector('.interrupt');
  const content = document.getElementById('interrupt-content');

  content.innerHTML = `
    <div class="screen">
      <div class="memo">
        <h2 class="memo__title">${label}</h2>
        <p class="memo__text">Add some content in the admin panel on your phone.</p>
      </div>
    </div>
  `;

  el.classList.add('interrupt--active', 'interrupt--no-dismiss');
  currentInterrupt = { type: 'empty-' + type };
}

// --- State ---
let currentInterrupt = null;
let photoTimer = null;
let photoCountdownInterval = null;
let trashDismissedDate = null; // Tracks whether trash was dismissed today
const PHOTO_INTERVAL = 120000; // 120 seconds

// --- Clock ---
function updateClock() {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  document.getElementById('clock-time').textContent = `${displayHours}:${minutes} ${ampm}`;
  document.getElementById('clock-date').textContent = `${days[now.getDay()]}, ${months[now.getMonth()]} ${now.getDate()}`;
}

// --- Device Icons (PNG, served from /device-icons/) ---
// Shared icons use CSS invert(1) for the alternate state.
const ICON = {
  light:       '/device-icons/lightbulb.png',
  fan:         '/device-icons/fan.png',
  vacuum:      '/device-icons/robotic.vacuum.png',
  scene:       '/device-icons/square.dashed.png',
  switch_on:   '/device-icons/lightswitch.on.png',
  switch_off:  '/device-icons/lightswitch.off.png',
  lock_on:     '/device-icons/shield.fill.png',
  lock_off:    '/device-icons/shield.png',
  cover_on:    '/device-icons/door.garage.open.png',
  cover_off:   '/device-icons/door.garage.closed.png',
  climate:     '/device-icons/poweroutlet.type.b.png',
  default:     '/device-icons/fan.png',
};

// --- Inline SVG Icons (non-device: interrupts, weather, etc.) ---
const ICONS = {
  trash: `<svg class="icon" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 01 2 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 2 01-2-2L5 6"/></svg>`,
  calendar: `<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`,
  sun: `<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`,
};

// --- Icon selection by device type + state ---
function getDeviceIconSrc(device) {
  const isOn = !!device.is_on;
  const type = device.device_type || 'switch';

  if (type === 'climate') return { src: ICON.climate, isOn: false };
  if (type === 'switch') return { src: isOn ? ICON.switch_on : ICON.switch_off, isOn };
  if (type === 'lock') return { src: isOn ? ICON.lock_on : ICON.lock_off, isOn };
  if (type === 'cover') return { src: isOn ? ICON.cover_on : ICON.cover_off, isOn };

  // Shared icon — single image, CSS invert handles off state
  return { src: ICON[type] || ICON.default, isOn };
}

function getSceneIconSrc(isActive) {
  return { src: ICON.scene, isOn: isActive };
}

// --- App Launcher ---
const LAUNCHER_APPS = [
  { id: null, label: 'Auto', icon: '/device-icons/auto.png' },
  { id: 'photo', label: 'Photos', icon: '/device-icons/photos.png' },
  { id: 'weather', label: 'Weather', icon: '/device-icons/weather.png' },
  { id: 'memo', label: 'Memo', icon: '/device-icons/memo.png' },
  { id: 'list', label: 'List', icon: '/device-icons/list.png' },
  { id: 'movie', label: 'Movie', icon: '/device-icons/movie.png' },
  { id: 'ha', label: 'Home', icon: '/device-icons/home.png' },
];

let launcherOpen = false;

function createAppLauncher() {
  const overlay = document.createElement('div');
  overlay.className = 'app-launcher';
  overlay.id = 'app-launcher';

  const grid = document.createElement('div');
  grid.className = 'app-launcher__grid';

  LAUNCHER_APPS.forEach(app => {
    const item = document.createElement('button');
    item.className = 'app-launcher__item';
    item.setAttribute('aria-label', `Show ${app.label}`);
    item.innerHTML = `
      <div class="app-launcher__icon"><img src="${app.icon}" alt="" /></div>
      <span class="app-launcher__label">${app.label}</span>
    `;
    item.addEventListener('click', async () => {
      const screenValue = app.id; // null for auto
      try {
        await fetch('/api/display-override', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ screen: screenValue }),
        });
        displayOverride = screenValue;
      } catch (err) {
        console.error('Failed to set display override:', err);
      }
      closeAppLauncher();
    });
    grid.appendChild(item);
  });

  overlay.appendChild(grid);

  // Click outside grid closes the launcher
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeAppLauncher();
  });

  document.body.appendChild(overlay);
}

function openAppLauncher() {
  const dock = document.getElementById('dock');
  const btn = document.getElementById('dock-home-btn');
  btn.classList.add('dock__home-btn--launcher-open');
  const img = btn.querySelector('img');
  if (img) img.src = '/device-icons/dock_close.png';
  document.getElementById('app-launcher').classList.add('app-launcher--active');
  launcherOpen = true;
}

function closeAppLauncher() {
  const dock = document.getElementById('dock');
  const btn = document.getElementById('dock-home-btn');
  btn.classList.remove('dock__home-btn--launcher-open');
  const img = btn.querySelector('img');
  if (img) img.src = '/device-icons/dock_open.png';
  document.getElementById('app-launcher').classList.remove('app-launcher--active');
  launcherOpen = false;
}

// --- Dock ---
function createHomeButton() {
  const btn = document.createElement('button');
  btn.className = 'dock__home-btn';
  btn.id = 'dock-home-btn';
  btn.setAttribute('aria-label', 'Toggle app launcher');
  btn.innerHTML = '<img src="/device-icons/dock_open.png" alt="Launch" />';
  btn.addEventListener('click', () => {
    if (launcherOpen) {
      closeAppLauncher();
    } else {
      openAppLauncher();
    }
  });
  return btn;
}

function createTile(device) {
  const tile = document.createElement('div');
  const isOn = !!device.is_on;
  const isActive = !!device.is_active;
  const { src: iconSrc, isOn: iconIsOn } = getDeviceIconSrc(device);
  tile.className = `tile${isActive ? ' tile--active' : ''}${iconIsOn ? ' tile--on' : ''}`;
  tile.dataset.haDeviceId = device.id;
  tile.dataset.deviceType = device.device_type || 'switch';
  tile.setAttribute('role', 'button');
  tile.setAttribute('aria-label', `${device.name}: ${isOn ? 'on' : 'off'}. Tap to toggle.`);
  const displayName = device.name.length > 20 ? device.name.slice(0, 20) + '…' : device.name;
  tile.innerHTML = `
    <div class="tile__icon"><img src="${iconSrc}" alt="" /></div>
    <div class="tile__content">
      <span class="tile__name">${displayName}</span>
    </div>
  `;
  tile.addEventListener('click', () => toggleHaDevice(device.id));
  return tile;
}

function createSceneTile(scene) {
  const tile = document.createElement('div');
  const isActive = !!scene.is_active;
  const { src: iconSrc } = getSceneIconSrc(isActive);
  tile.className = `tile${isActive ? ' tile--active' : ''}`;
  tile.dataset.haSceneId = scene.id;
  tile.setAttribute('role', 'button');
  tile.setAttribute('aria-label', `Activate ${scene.name}`);
  const displayName = scene.name.length > 20 ? scene.name.slice(0, 20) + '…' : scene.name;
  tile.innerHTML = `
    <div class="tile__icon"><img src="${iconSrc}" alt="" /></div>
    <div class="tile__content">
      <span class="tile__name">${displayName}</span>
    </div>
  `;
  tile.addEventListener('click', () => activateHaScene(scene.id));
  return tile;
}

function renderDock() {
  const dock = document.getElementById('dock');
  dock.innerHTML = '';

  const favDevices = haDevices.filter(d => d.is_active);
  const favScenes = haScenes.filter(s => s.is_active);
  const totalFavorites = favDevices.length + favScenes.length;
  const isEven = totalFavorites % 2 === 0;

  if (isEven && totalFavorites > 0) {
    // Even: [tiles…][home][tiles…]
    // Split devices evenly, then add scenes after
    const halfDevices = Math.ceil(favDevices.length / 2);
    for (let i = 0; i < halfDevices; i++) {
      dock.appendChild(createTile(favDevices[i]));
    }
    dock.appendChild(createHomeButton());
    for (let i = halfDevices; i < favDevices.length; i++) {
      dock.appendChild(createTile(favDevices[i]));
    }
    favScenes.forEach(scene => dock.appendChild(createSceneTile(scene)));
  } else {
    // Odd (or zero): [home][sep][tiles…]
    dock.appendChild(createHomeButton());
    const sep = document.createElement('div');
    sep.className = 'dock__separator';
    dock.appendChild(sep);
    favDevices.forEach(device => dock.appendChild(createTile(device)));
    favScenes.forEach(scene => dock.appendChild(createSceneTile(scene)));
  }
}

async function toggleHaDevice(deviceId) {
  try {
    const res = await fetch(`/api/ha/devices/${deviceId}/toggle`, { method: 'PUT' });
    if (!res.ok) throw new Error(`Toggle failed: ${res.status}`);
    const updated = await res.json();
    const idx = haDevices.findIndex(d => d.id === deviceId);
    if (idx !== -1) haDevices[idx] = updated;
    renderDock();
    if (currentInterrupt?.type === 'ha') showHA();
  } catch (err) {
    console.error('Toggle HA device error:', err);
  }
}

async function activateHaScene(sceneId) {
  try {
    const res = await fetch(`/api/ha/scenes/${sceneId}/activate`, { method: 'POST' });
    if (!res.ok) throw new Error(`Activate failed: ${res.status}`);
    // Toggle local active state
    const scene = haScenes.find(s => s.id === sceneId);
    if (scene) scene.is_active = !scene.is_active;
    if (currentInterrupt?.type === 'ha') showHA();
  } catch (err) {
    console.error('Activate HA scene error:', err);
  }
}


// --- Interrupt System ---
function showInterrupt({ type = 'interrupt', title, message, meta, icon, priority = 'info' }) {
  currentInterrupt = { type, title, message, meta, icon, priority };

  const el = document.getElementById('interrupt');
  const content = document.getElementById('interrupt-content');
  const border = document.querySelector('.attention-border');

  content.innerHTML = `
    ${icon ? `<div class="interrupt__icon">${icon}</div>` : ''}
    <div class="interrupt__title">${title}</div>
    ${message ? `<div class="interrupt__message">${message}</div>` : ''}
    ${meta ? `<div class="interrupt__meta">${meta}</div>` : ''}
  `;

  el.classList.add('interrupt--active');
  el.classList.remove('interrupt--no-dismiss');

  // Show attention border based on priority
  border.className = 'attention-border attention-border--active attention-border--' + priority;
}

function showWeather({ temp, unit, condition, high, low, feelsLike, icon, nowPct }) {
  const el = document.querySelector('.interrupt');
  const content = document.getElementById('interrupt-content');

  // Single 24h bar: low on left, high on right, white dot for "now"
  const barHTML = `
    <div class="weather-interrupt__hourly">
      <span class="weather-interrupt__hourly-label">${low}°</span>
      <div class="weather-interrupt__bar-track">
        <div class="weather-interrupt__bar-fill"></div>
        <div class="weather-interrupt__bar-now" style="left:${nowPct || 35}%" title="${temp}° now"></div>
      </div>
      <span class="weather-interrupt__hourly-value">${high}°</span>
    </div>
  `;

  content.innerHTML = `
    <div class="screen">
      <div class="weather-interrupt">
        <div class="weather-interrupt__header">
          <div class="weather-interrupt__icon">${icon || ICONS.sun}</div>
          <div class="weather-interrupt__temp-group">
            <span class="weather-interrupt__temp">${temp}</span>
            <span class="weather-interrupt__unit">${unit || '°F'}</span>
          </div>
          <div class="weather-interrupt__info">
            <span class="weather-interrupt__condition">${condition}</span>
            <span class="weather-interrupt__range">H:<span class="weather-interrupt__range-high">${high}</span> L:${low}</span>
            <span class="weather-interrupt__feels-like">Feels like ${feelsLike}°</span>
          </div>
        </div>
        ${barHTML}
      </div>
    </div>
  `;

  el.classList.add('interrupt--active', 'interrupt--no-dismiss');
  currentInterrupt = { type: 'weather' };
}

function dismissInterrupt() {
  const wasTrash = currentInterrupt?.type === 'trash';
  currentInterrupt = null;

  const el = document.getElementById('interrupt');
  const border = document.querySelector('.attention-border');
  const content = document.getElementById('interrupt-content');
  const dock = document.getElementById('dock');

  el.classList.remove('interrupt--active', 'interrupt--no-dismiss');
  border.className = 'attention-border';
  content.innerHTML = '';
  dock.classList.remove('dock--photo-mode');
  document.getElementById('dock-home-btn')?.classList.remove('is-active');

  if (photoTimer) clearTimeout(photoTimer);
  if (photoCountdownInterval) clearInterval(photoCountdownInterval);
  document.getElementById('countdown-bar').style.display = 'none';

  if (wasTrash) trashDismissedDate = new Date().toISOString().slice(0, 10);
}

// --- Photo Frame Interrupt ---
let currentPhotoIndex = 0;

// Swipe state for photo navigation
const SWIPE_THRESHOLD = 60; // px to count as a swipe
let swipeStartX = null;
let swipeStartY = null;
let isSwiping = false;

function initPhotoSwipeListeners() {
  const el = document.querySelector('.interrupt');
  if (!el) return;

  el.addEventListener('touchstart', (e) => {
    swipeStartX = e.touches[0].clientX;
    swipeStartY = e.touches[0].clientY;
    isSwiping = true;
  }, { passive: true });

  el.addEventListener('touchmove', (e) => {
    if (!isSwiping || !swipeStartX) return;
    const dx = Math.abs(e.touches[0].clientX - swipeStartX);
    const dy = Math.abs(e.touches[0].clientY - swipeStartY);
    if (dx > dy && dx > 10) {
      e.preventDefault();
    }
  }, { passive: false });

  el.addEventListener('touchend', (e) => {
    if (!isSwiping || !swipeStartX) return;
    const dx = e.changedTouches[0].clientX - swipeStartX;
    const dy = Math.abs(e.changedTouches[0].clientY - swipeStartY);
    swipeStartX = null;
    swipeStartY = null;
    isSwiping = false;

    // Only handle swipes when showing photos
    if (!currentInterrupt || currentInterrupt.type !== 'photo') return;
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < dy) return;
    if (photoUrls.length <= 1) return;

    const countdownBar = document.getElementById('countdown-bar');
    const countdownFill = document.getElementById('countdown-fill');

    if (dx < 0) {
      // Swipe left → next photo
      currentPhotoIndex = (currentPhotoIndex + 1) % photoUrls.length;
    } else {
      // Swipe right → previous photo
      currentPhotoIndex = (currentPhotoIndex - 1 + photoUrls.length) % photoUrls.length;
    }

    navigatePhotoWithSlide(dx < 0 ? 'left' : 'right', countdownBar, countdownFill);
  }, { passive: true });
}

function navigatePhotoWithSlide(direction, countdownBar, countdownFill) {
  const content = document.getElementById('interrupt-content');
  const existingImg = content.querySelector('.photo-frame img');
  if (!existingImg) return;

  const nextUrl = photoUrls[currentPhotoIndex];
  const next = new Image();
  next.onload = () => {
    const container = existingImg.parentElement;

    const startX = direction === 'left' ? '100%' : '-100%';
    const endX = direction === 'left' ? '-100%' : '100%';

    const overlay = document.createElement('img');
    overlay.src = nextUrl;
    overlay.style.cssText = `
      position:absolute;inset:0;width:100%;height:100%;
      object-fit:cover;z-index:10;
      transform:translateX(${startX});
      transition:transform 3s cubic-bezier(0.4,0,0.2,1);
    `;
    container.appendChild(overlay);

    void overlay.offsetHeight;

    existingImg.style.transition = 'transform 3s cubic-bezier(0.4,0,0.2,1), opacity 3s ease';
    existingImg.style.transform = `translateX(${endX})`;
    existingImg.style.opacity = '0';
    overlay.style.transform = 'translateX(0)';

    setTimeout(() => {
      existingImg.src = nextUrl;
      existingImg.style.transition = 'none';
      existingImg.style.transform = '';
      existingImg.style.opacity = '';
      overlay.remove();
      startPhotoTimer(countdownBar, countdownFill);
    }, 3100);
  };
  next.onerror = () => startPhotoTimer(countdownBar, countdownFill);
  next.src = nextUrl;
}

function showPhoto() {
  if (!photoUrls.length) return;
  const el = document.querySelector('.interrupt');
  const content = document.getElementById('interrupt-content');
  const countdownBar = document.getElementById('countdown-bar');
  const countdownFill = document.getElementById('countdown-fill');
  const hasMultiple = photoUrls.length > 1;

  // Sequential order
  const idx = currentPhotoIndex;

  const nextUrl = photoUrls[idx];

  // If already showing a photo frame, slide LTR
  const existingImg = content.querySelector('.photo-frame img');
  if (existingImg && hasMultiple) {
    const next = new Image();
    next.onload = () => {
      const container = existingImg.parentElement;

      // Place overlay off-screen to the right
      const overlay = document.createElement('img');
      overlay.src = nextUrl;
      overlay.style.cssText = `
        position:absolute;inset:0;width:100%;height:100%;
        object-fit:cover;z-index:10;
        transform:translateX(100%);
        transition:transform 3s cubic-bezier(0.4,0,0.2,1);
      `;
      container.appendChild(overlay);

      // Force reflow so browser paints the starting position
      void overlay.offsetHeight;

      // Now trigger both animations simultaneously
      existingImg.style.transition = 'transform 3s cubic-bezier(0.4,0,0.2,1), opacity 3s ease';
      existingImg.style.transform = 'translateX(-100%)';
      existingImg.style.opacity = '0';
      overlay.style.transform = 'translateX(0)';

      setTimeout(() => {
        existingImg.src = nextUrl;
        existingImg.style.transition = 'none';
        existingImg.style.transform = '';
        existingImg.style.opacity = '';
        overlay.remove();
        currentPhotoIndex = (currentPhotoIndex + 1) % photoUrls.length;
        startPhotoTimer(countdownBar, countdownFill);
      }, 3100);
    };
    next.onerror = () => startPhotoTimer(countdownBar, countdownFill);
    next.src = nextUrl;
    return;
  }

  // First load
  content.innerHTML = `
    <div class="photo-frame">
      <img src="${nextUrl}" alt="" loading="lazy" />
    </div>
  `;

  el.classList.add('interrupt--active', 'interrupt--no-dismiss');
  currentInterrupt = { type: 'photo' };

  if (hasMultiple) {
    currentPhotoIndex = (currentPhotoIndex + 1) % photoUrls.length;
    startPhotoTimer(countdownBar, countdownFill);
  }

  document.getElementById('dock').classList.add('dock--photo-mode');
}

// --- List Interrupt ---
function showList(items) {
  const el = document.querySelector('.interrupt');
  const content = document.getElementById('interrupt-content');

  const listHTML = items.map(item => `<li class="list__item">${item}</li>`).join('');

  content.innerHTML = `
    <div class="screen">
      <div class="list">
        <ul class="list__items">${listHTML}</ul>
      </div>
      <span class="screen-edit-pill">edit in the admin panel on your phone</span>
    </div>
  `;

  el.classList.add('interrupt--active', 'interrupt--no-dismiss');
  currentInterrupt = { type: 'list' };
}

// --- Memo Interrupt ---
function showMemo(title, text) {
  const el = document.querySelector('.interrupt');
  const content = document.getElementById('interrupt-content');

  content.innerHTML = `
    <div class="screen">
      <div class="memo">
        <h2 class="memo__title">${title}</h2>
        <p class="memo__text">${text}</p>
      </div>
      <span class="screen-edit-pill">edit in the admin panel on your phone</span>
    </div>
  `;

  el.classList.add('interrupt--active', 'interrupt--no-dismiss');
  currentInterrupt = { type: 'memo' };
}

// --- Calendar Event Interrupt (unified with interrupt system) ---
function showCalendarEvent(event) {
  showInterrupt({
    title: event.title,
    message: event.time,
    meta: event.location || null,
    icon: ICONS.calendar,
    priority: 'info',
  });
  // Override icon color to blue for calendar events
  document.querySelector('.interrupt__icon').style.color = 'var(--color-accent)';
}

// --- Movie Poster Interrupt ---
function showMovie(movieIndex = 0) {
  const movie = movieData;
  if (!movie) return;

  const el = document.querySelector('.interrupt');
  const content = document.getElementById('interrupt-content');

  const posterSrc = movie.poster_url || 'scratchpics/movie.jpg';
  const placeholderPoster = !movie.validated && !movie.poster_url;

  content.innerHTML = `
    <div class="screen">
      <div class="movie-poster">
        <div class="movie-poster__frame">
          ${placeholderPoster
            ? `<div class="movie-poster__placeholder">?</div>`
            : `<img class="movie-poster__image" src="${posterSrc}" alt="${movie.title}" />`}
        </div>
        <div class="movie-poster__info">
          <h2 class="movie-poster__title">${movie.title}</h2>
          ${movie.year ? `<span class="movie-poster__year">${movie.year}</span>` : ''}
          ${movie.actors ? `<span class="movie-poster__actors">${movie.actors}</span>` : ''}
          <p class="movie-poster__blurb">${movie.blurb}</p>
        </div>
      </div>
    </div>
  `;

  el.classList.add('interrupt--active', 'interrupt--no-dismiss');
  currentInterrupt = { type: 'movie' };
}

// --- Home Assistant Screen ---
function showHA() {
  const el = document.querySelector('.interrupt');
  const content = document.getElementById('interrupt-content');

  const scenesHTML = haScenes.map(scene => {
    const { src: iconSrc, isOn: iconIsOn } = getSceneIconSrc(!!scene.is_active);
    return `
      <div class="tile${scene.is_active ? ' tile--active' : ''}${iconIsOn ? ' tile--on' : ''}" data-ha-scene-id="${scene.id}" role="button" aria-label="Activate ${scene.name}">
        <div class="tile__icon"><img src="${iconSrc}" alt="" /></div>
        <div class="tile__content">
          <span class="tile__name">${scene.name}</span>
        </div>
      </div>
    `;
  }).join('');

  const tiles = haDevices.map(device => {
    const isOn = !!device.is_on;
    const isActive = !!device.is_active;
    const { src: iconSrc, isOn: iconIsOn } = getDeviceIconSrc(device);
    return `
      <div class="tile${isActive ? ' tile--active' : ''}${iconIsOn ? ' tile--on' : ''}" data-ha-device-id="${device.id}" data-device-type="${device.device_type || 'switch'}" role="button" aria-label="${device.name}: ${isOn ? 'on' : 'off'}. Tap to toggle.">
        <div class="tile__icon"><img src="${iconSrc}" alt="" /></div>
        <div class="tile__content">
          <span class="tile__name">${device.name}</span>
        </div>
      </div>
    `;
  }).join('');

  content.innerHTML = `
    <div class="screen">
      <div class="ha-screen">
        <div class="ha-screen__scenes">${scenesHTML}</div>
        <hr class="ha-screen__divider" />
        <div class="ha-screen__devices">${tiles}</div>
      </div>
    </div>
  `;

  content.querySelectorAll('[data-ha-device-id]').forEach(tile => {
    tile.addEventListener('click', () => {
      const id = parseInt(tile.dataset.haDeviceId);
      toggleHaDevice(id);
    });
  });

  content.querySelectorAll('[data-ha-scene-id]').forEach(tile => {
    tile.addEventListener('click', () => {
      const sceneId = tile.dataset.haSceneId;
      activateHaScene(sceneId);
    });
  });

  el.classList.add('interrupt--active', 'interrupt--no-dismiss');
  currentInterrupt = { type: 'ha' };
  document.getElementById('dock-home-btn')?.classList.add('is-active');
}

function startPhotoTimer(countdownBar, countdownFill) {
  countdownBar.style.display = 'block';
  const startTime = Date.now();

  if (photoCountdownInterval) clearInterval(photoCountdownInterval);
  photoCountdownInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const pct = Math.max(0, 100 - (elapsed / PHOTO_INTERVAL * 100));
    countdownFill.style.height = pct + '%';
  }, 1000);

  if (photoTimer) clearTimeout(photoTimer);
  photoTimer = setTimeout(() => {
    if (currentInterrupt?.type === 'photo') showPhoto();
  }, PHOTO_INTERVAL);
}

// --- SSE Real-Time Updates ---
let sseSource = null;

function connectSSE() {
  sseSource = new EventSource('/api/events');

  sseSource.addEventListener('update', (e) => {
    const eventType = e.data; // 'photos', 'memo', 'movie', 'list-items', 'display-override'
    handleSSEUpdate(eventType);
  });

  sseSource.onerror = () => {
    console.log('SSE connection lost — reconnecting…');
    // EventSource auto-reconnects, no action needed
  };
}

async function handleSSEUpdate(eventType) {
  // Save previous state snapshots
  const prev = {
    photos: JSON.stringify(photoUrls),
    memo: JSON.stringify(memoData),
    movie: JSON.stringify(movieData),
    list: JSON.stringify(listItems),
    override: displayOverride,
    ha: JSON.stringify(haDevices),
    haScenes: JSON.stringify(haScenes),
  };

  // Fetch fresh data for the affected type
  try {
    switch (eventType) {
      case 'photos': {
        const res = await fetch('/api/photos').then(r => r.ok ? r.json() : []);
        photoUrls = res.map(p => `/photos/${p.filename}`);
        break;
      }
      case 'memo': {
        const res = await fetch('/api/memo').then(r => r.ok ? r.json() : null).catch(() => null);
        memoData = res;
        break;
      }
      case 'movie': {
        const res = await fetch('/api/movie').then(r => r.ok ? r.json() : null).catch(() => null);
        movieData = res;
        break;
      }
      case 'list-items': {
        const res = await fetch('/api/list-items').then(r => r.ok ? r.json() : []).catch(() => []);
        listItems = res;
        break;
      }
      case 'display-override': {
        const res = await fetch('/api/display-override').then(r => r.ok ? r.json() : {}).catch(() => ({}));
        displayOverride = res.screen || null;
        break;
      }
      case 'ha-devices': {
        const res = await fetch('/api/ha/devices').then(r => r.ok ? r.json() : []).catch(() => []);
        haDevices = res;
        break;
      }
      case 'ha-scenes': {
        const res = await fetch('/api/ha/scenes').then(r => r.ok ? r.json() : []).catch(() => []);
        haScenes = res;
        break;
      }
    }
  } catch (err) {
    console.error('SSE update fetch error:', err);
    return;
  }

  // Check what actually changed and re-render if needed
  const changed = {
    photos: JSON.stringify(photoUrls) !== prev.photos,
    memo: JSON.stringify(memoData) !== prev.memo,
    movie: JSON.stringify(movieData) !== prev.movie,
    list: JSON.stringify(listItems) !== prev.list,
    override: displayOverride !== prev.override,
    ha: JSON.stringify(haDevices) !== prev.ha,
    haScenes: JSON.stringify(haScenes) !== prev.haScenes,
  };

  // If override changed, check if we need to switch screens
  if (changed.override) {
    const next = getScheduledScreen();
    const current = currentInterrupt?.type;
    if (next !== current) {
      dismissInterrupt();
      renderScreen(next);
    }
    return;
  }

  // Re-render current interrupt if its data changed
  if (!currentInterrupt) return;

  switch (currentInterrupt.type) {
    case 'memo':
      if (changed.memo && memoData) showMemo(memoData.title, memoData.content);
      break;
    case 'photo':
      if (changed.photos) { currentPhotoIndex = 0; showPhoto(); }
      break;
    case 'movie':
      if (changed.movie) showMovie();
      break;
    case 'list':
      if (changed.list && listItems.length) showList(listItems.map(i => i.text));
      break;
    case 'ha':
      if ((changed.ha || changed.haScenes) && haDevices.length) showHA();
      break;
  }

  // Always re-render dock when HA devices or scenes change (dock is always visible)
  if (changed.ha || changed.haScenes) renderDock();
}

// --- Init ---
document.addEventListener('DOMContentLoaded', async () => {
  createAppLauncher();
  renderDock();

  document.getElementById('interrupt-dismiss').addEventListener('click', () => {
    dismissInterrupt();
    renderScreen('photo');
  });

  // Photo swipe navigation
  initPhotoSwipeListeners();

  // Clock
  updateClock();
  setInterval(updateClock, 1000);

  // Fetch live data from backend + weather
  await Promise.all([fetchDashboardData(), fetchWeather()]);

  // Render dock with actual data
  renderDock();

  // Connect to SSE for real-time updates
  connectSSE();

  // Show scheduled screen
  showScheduledScreen();

  // Track schedule slot to detect boundary crossings (clears manual override)
  let lastSlot = getScheduleSlot();

  // Re-check schedule every minute and switch if it changed
  setInterval(async () => {
    const currentSlot = getScheduleSlot();

    // If we crossed into a new time slot, clear any manual override
    if (displayOverride && currentSlot !== lastSlot) {
      try {
        await fetch('/api/display-override', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ screen: null }),
        });
        displayOverride = null;
      } catch (err) {
        console.error('Failed to clear display override:', err);
      }
    }
    lastSlot = currentSlot;

    const next = getScheduledScreen();
    const today = new Date().toISOString().slice(0, 10);
    const effectiveNext = (next === 'trash' && trashDismissedDate === today) ? 'photo' : next;
    const current = currentInterrupt?.type;
    if (effectiveNext !== current) {
      dismissInterrupt();
      renderScreen(effectiveNext);
    }
  }, 60000);

  // Poll for updates every 30s — re-render current screen if data changed
  setInterval(async () => {
    const prevMemo = JSON.stringify(memoData);
    const prevPhotos = JSON.stringify(photoUrls);
    const prevMovie = JSON.stringify(movieData);
    const prevList = JSON.stringify(listItems);
    const prevWeather = JSON.stringify(weatherData);
    const prevHA = JSON.stringify(haDevices);

    await Promise.all([fetchDashboardData(), fetchWeather()]);

    const memoChanged = JSON.stringify(memoData) !== prevMemo;
    const photosChanged = JSON.stringify(photoUrls) !== prevPhotos;
    const movieChanged = JSON.stringify(movieData) !== prevMovie;
    const listChanged = JSON.stringify(listItems) !== prevList;
    const weatherChanged = JSON.stringify(weatherData) !== prevWeather;
    const haChanged = JSON.stringify(haDevices) !== prevHA;

    // Re-render current interrupt if its data changed
    if (currentInterrupt) {
      switch (currentInterrupt.type) {
        case 'error':
          // Backend reachable again — drop the error screen and resume schedule
          dismissInterrupt();
          showScheduledScreen();
          break;
        case 'memo':
          if (memoChanged && memoData) showMemo(memoData.title, memoData.content);
          break;
        case 'photo':
          if (photosChanged) { currentPhotoIndex = 0; showPhoto(); }
          break;
        case 'movie':
          if (movieChanged) showMovie();
          break;
        case 'list':
          if (listChanged && listItems.length) showList(listItems.map(i => i.text));
          break;
        case 'weather':
          if (weatherChanged && weatherData) showWeather(weatherData);
          break;
        case 'ha':
          if (haChanged && haDevices.length) showHA();
          break;
      }
    }

    // Always re-render dock when HA devices change
    if (haChanged) renderDock();
  }, 30000);

});
