// ============================================
// SKYLIGHT HOME v3
// Calmscreen + Interrupt + Dock
// ============================================

// --- Config ---
const CONFIG = {
  dockDevices: [
    { id: 'railing', entity_id: 'switch.smart_wi_fi_plug', name: 'Railing', type: 'switch', icon: 'switch', isActive: true },
    { id: 'bedroom_light', entity_id: 'light.smart_multicolor_bulb', name: 'Bedroom Light', type: 'light', icon: 'light' },
    { id: 'christmas_tree', entity_id: 'switch.smart_wi_fi_plug_2', name: 'Christmas Tree', type: 'switch', icon: 'switch' },
  ],
};

// --- Live data (fetched from /admin backend) ---
let photoUrls = [];
let movieData = null;
let memoData = null;
let listItems = [];
let weatherData = null;

async function fetchDashboardData() {
  try {
    const [photosRes, movieRes, memoRes, listRes] = await Promise.all([
      fetch('/api/photos').then(r => r.ok ? r.json() : []),
      fetch('/api/movie').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/memo').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/list-items').then(r => r.ok ? r.json() : []).catch(() => []),
    ]);

    photoUrls = photosRes.map(p => `/photos/${p.filename}`);
    movieData = movieRes;
    memoData = memoRes;
    listItems = listRes;
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

async function fetchWeather() {
  try {
    // Owens Cross Roads, AL
    const res = await fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=34.2444&longitude=-86.7589'
      + '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m'
      + '&daily=temperature_2m_max,temperature_2m_min'
      + '&timezone=America%2FChicago&temperature_unit=fahrenheit',
      { cache: 'no-cache' },
    );
    if (!res.ok) return;

    const data = await res.json();
    const c = data.current;
    const d = data.daily;

    weatherData = {
      temp: Math.round(c.temperature_2m),
      feelsLike: Math.round(c.apparent_temperature),
      condition: WMO_CODES[c.weather_code] || 'Unknown',
      high: Math.round(d.temperature_2m_max[0]),
      low: Math.round(d.temperature_2m_min[0]),
      humidity: c.relative_humidity_2m,
      windSpeed: Math.round(c.wind_speed_10m * 0.621371), // km/h → mph
    };
  } catch (err) {
    console.error('Fetch weather error:', err);
  }
}

// --- Error State ---
function showError() {
  const el = document.querySelector('.interrupt');
  const content = document.getElementById('interrupt-content');

  content.innerHTML = `
    <div class="memo">
      <h2 class="memo__title">Connection Lost</h2>
      <p class="memo__text">Unable to reach the backend. The page will retry automatically.</p>
    </div>
  `;

  el.classList.add('interrupt--active', 'interrupt--no-dismiss');
  currentInterrupt = { type: 'error' };
}

// --- State ---
let currentInterrupt = null;
let photoTimer = null;
let photoCountdownInterval = null;
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

// --- SVG Icons ---
const ICONS = {
  light: `<svg class="icon" viewBox="0 0 24 24"><path d="M9 18h6M10 22h4M12 2v1M4.22 4.22l.71.1M1 12h1M20 12h1M18.36 4.22l-.71.71M12 14a4 4 0 00-8 0"/></svg>`,
  switch: `<svg class="icon" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/><circle cx="12" cy="12" r="2"/></svg>`,
  climate: `<svg class="icon" viewBox="0 0 24 24"><path d="M12 2v5M12 17v5M4.93 4.93l3.54 3.54M2 12h5M17 12h5M4.93 19.07 7.47 15.53M15.54 8.46 19.07 4.93"/></svg>`,
  lock: `<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>`,
  fan: `<svg class="icon" viewBox="0 0 24 24"><path d="M12 12c0-3 2.5-6 6-6M12 12c3 0 6-2.5-6-6M12 12c0 3-2.5 6-6 6M12 12c-3 0-6-2.5-6 6"/><circle cx="12" cy="12" r="2"/></svg>`,
  trash: `<svg class="icon" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 01 2 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 2 01-2-2L5 6"/></svg>`,
  calendar: `<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`,
  rain: `<svg class="icon" viewBox="0 0 24 24"><path d="M20 17v1a2 2 0 01-2 2H6a2 2 0 01-2-2M12 14v-3M8 11v-3M16 11v-3"/><path d="M18 10a4 4 0 00-4-4H6a4 4 0 00-4 4c 0 2 1.5 3 3 3.5"/></svg>`,
  sun: `<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`,
  cloud: `<svg class="icon" viewBox="0 0 24 24"><path d="M18 10a4 4 0 00-4-4 6 6 0 00-6 6 3 3 0 003 3h7a4 4 0 000-8z"/></svg>`,
};

// --- Dock ---
function renderDock() {
  const dock = document.getElementById('dock');
  dock.querySelectorAll('.tile').forEach(t => t.remove());

  CONFIG.dockDevices.forEach(device => {
    const tile = document.createElement('div');
    tile.className = `tile${device.isActive ? ' tile--active' : ''}${device.isOn ? ' tile--on' : ''}`;
    tile.dataset.deviceId = device.id;
    tile.innerHTML = `
      <div class="tile__icon">${ICONS[device.icon] || ICONS.switch}</div>
      <div class="tile__content">
        <span class="tile__name">${device.name}</span>
        <span class="tile__status">${device.status || ''}</span>
      </div>
    `;
    tile.addEventListener('click', () => toggleDevice(device.id));
    dock.appendChild(tile);
  });
}



// --- Interrupt System ---
function showInterrupt({ title, message, meta, icon, priority = 'info' }) {
  currentInterrupt = { title, message, meta, icon, priority };

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
  `;

  el.classList.add('interrupt--active', 'interrupt--no-dismiss');
  currentInterrupt = { type: 'weather' };
}

function dismissInterrupt() {
  currentInterrupt = null;

  const el = document.getElementById('interrupt');
  const border = document.querySelector('.attention-border');
  const content = document.getElementById('interrupt-content');
  const dock = document.getElementById('dock');

  el.classList.remove('interrupt--active');
  border.className = 'attention-border';
  content.innerHTML = '';
  dock.classList.remove('dock--photo-mode');

  if (photoTimer) clearTimeout(photoTimer);
  if (photoCountdownInterval) clearInterval(photoCountdownInterval);
}

// --- Photo Frame Interrupt ---
let currentPhotoIndex = 0;

function showPhoto() {
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
    <div class="list">
      <ul class="list__items">${listHTML}</ul>
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
    <div class="memo">
      <h2 class="memo__title">${title}</h2>
      <p class="memo__text">${text}</p>
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
    <div class="movie-poster">
      <div class="movie-poster__frame">
        ${placeholderPoster
          ? `<div class="movie-poster__placeholder">?</div>`
          : `<img class="movie-poster__image" src="${posterSrc}" alt="${movie.title}" />`}
      </div>
      <div class="movie-poster__info">
        <h2 class="movie-poster__title">${movie.title}</h2>
        ${movie.year ? `<span class="movie-poster__year">${movie.year}</span>` : ''}
        ${movie.rating ? `<span class="movie-poster__rating">★ ${movie.rating.toFixed(1)}</span>` : ''}
        <p class="movie-poster__blurb">${movie.blurb}</p>
      </div>
    </div>
  `;

  el.classList.add('interrupt--active', 'interrupt--no-dismiss');
  currentInterrupt = { type: 'movie' };
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
    showPhoto();
  }, PHOTO_INTERVAL);
}

// --- Init ---
document.addEventListener('DOMContentLoaded', async () => {
  renderDock();

  document.getElementById('interrupt-dismiss').addEventListener('click', dismissInterrupt);

  // Clock
  updateClock();
  setInterval(updateClock, 1000);

  // Fetch live data from backend + weather
  await Promise.all([fetchDashboardData(), fetchWeather()]);

  // Auto-show photo frame if we have photos, otherwise show memo
  if (photoUrls.length > 0) {
    showPhoto();
  } else if (memoData) {
    showMemo(memoData.title, memoData.content);
  }

  // Poll for updates every 30s — re-render current screen if data changed
  setInterval(async () => {
    const prevMemo = JSON.stringify(memoData);
    const prevPhotos = JSON.stringify(photoUrls);
    const prevMovie = JSON.stringify(movieData);
    const prevList = JSON.stringify(listItems);
    const prevWeather = JSON.stringify(weatherData);

    await Promise.all([fetchDashboardData(), fetchWeather()]);

    const memoChanged = JSON.stringify(memoData) !== prevMemo;
    const photosChanged = JSON.stringify(photoUrls) !== prevPhotos;
    const movieChanged = JSON.stringify(movieData) !== prevMovie;
    const listChanged = JSON.stringify(listItems) !== prevList;
    const weatherChanged = JSON.stringify(weatherData) !== prevWeather;

    // Re-render current interrupt if its data changed
    if (currentInterrupt) {
      switch (currentInterrupt.type) {
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
      }
    }
  }, 30000);

});
