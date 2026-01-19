/**
 * Skylight Home Mobile PWA
 *
 * iOS-style home control app with:
 * - Room-based device organization
 * - Color picker with hex/HSL input
 * - Shared color palette
 * - Grid/list view toggle
 */

'use strict';

// ============================================
// GLOBAL STATE
// ============================================

let mobileConfig = null;
let deviceStates = {};
let currentRoom = null;
let currentDevice = null;
let currentCategory = 'all';
let isListView = false;
let longPressTimer = null;
let colorWheelCtx = null;

// Widget state is managed by shared/widgets.js (WidgetState)

// ============================================
// INITIALIZATION
// ============================================

async function init() {
  try {
    // Load mobile config
    mobileConfig = await loadConfig('mobile-config.json');

    // Set up event listeners
    setupNavigation();
    setupCategoryPills();
    setupControlModal();

    // Render initial view
    renderRooms();

    // Fetch initial data in parallel
    await Promise.all([
      fetchAllDeviceStates(),
      fetchWeather(),
      fetchNotifications(),
      fetchShipments()
    ]);

    // Start polling intervals
    setInterval(fetchAllDeviceStates, 10000);  // 10 sec
    setInterval(fetchWeather, 1800000);        // 30 min
    setInterval(fetchNotifications, 300000);   // 5 min
    setInterval(fetchShipments, 300000);       // 5 min

    // Update connection status
    updateConnectionStatus(true);

    console.log('Skylight Mobile initialized');
  } catch (error) {
    console.error('Initialization error:', error);
    updateConnectionStatus(false);
  }
}

// ============================================
// NAVIGATION
// ============================================

function setupNavigation() {
  // Back button
  document.getElementById('back-to-home')?.addEventListener('click', () => {
    showView('home');
  });

  // View toggle
  document.getElementById('view-toggle')?.addEventListener('click', () => {
    isListView = !isListView;
    const icon = document.querySelector('#view-toggle use');
    if (icon) {
      icon.setAttribute('href', isListView ? '#icon-grid' : '#icon-list');
    }
    renderRoomDevices();
  });
}

function showView(viewName) {
  document.querySelectorAll('.view').forEach(v => {
    v.classList.remove('view--active');
  });

  const view = document.getElementById(`view-${viewName}`);
  if (view) {
    view.classList.add('view--active');
  }

  if (viewName === 'home') {
    currentRoom = null;
  }
}

// ============================================
// CATEGORY PILLS
// ============================================

function setupCategoryPills() {
  document.querySelectorAll('.category-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      currentCategory = pill.dataset.category;
      document.querySelectorAll('.category-pill').forEach(p => {
        p.classList.toggle('category-pill--active', p === pill);
      });
      renderRooms();
    });
  });
}

// ============================================
// ROOMS
// ============================================

function renderRooms() {
  const container = document.getElementById('rooms-list');
  if (!container) return;

  const rooms = mobileConfig?.rooms || [];

  if (rooms.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg class="empty-state__icon"><use href="#icon-home"/></svg>
        <div class="empty-state__title">No Rooms Configured</div>
        <div class="empty-state__message">Add rooms in mobile-config.json</div>
      </div>
    `;
    return;
  }

  container.innerHTML = rooms.map(room => {
    const devices = getRoomDevices(room);
    const filteredDevices = filterDevicesByCategory(devices);
    const onCount = filteredDevices.filter(d => deviceStates[d.entity_id]?.is_on).length;
    const statusText = onCount > 0 ? `${onCount} on` : 'All off';
    const statusClass = onCount > 0 ? 'room-card__status--on' : '';

    // Skip rooms with no matching devices for current category
    if (currentCategory !== 'all' && filteredDevices.length === 0) {
      return '';
    }

    return `
      <div class="room-card" data-room-id="${room.id}">
        <div class="room-card__icon">
          <svg class="icon"><use href="#icon-${room.icon || 'home'}"/></svg>
        </div>
        <div class="room-card__info">
          <div class="room-card__name">${room.name}</div>
          <div class="room-card__status ${statusClass}">${statusText}</div>
        </div>
        <div class="room-card__chevron">
          <svg class="icon"><use href="#icon-chevron-right"/></svg>
        </div>
      </div>
    `;
  }).join('');

  // Add click handlers
  container.querySelectorAll('.room-card').forEach(card => {
    card.addEventListener('click', () => {
      const roomId = card.dataset.roomId;
      openRoom(roomId);
    });
  });
}

function getRoomDevices(room) {
  const devices = [];
  const deviceIds = room.devices || [];

  deviceIds.forEach(entityId => {
    const device = mobileConfig.devices?.[entityId];
    if (device) {
      devices.push({
        entity_id: entityId,
        ...device
      });
    }
  });

  return devices;
}

function filterDevicesByCategory(devices) {
  if (currentCategory === 'all') return devices;
  return devices.filter(d => {
    if (currentCategory === 'lights') return d.type === 'light';
    if (currentCategory === 'switches') return d.type === 'switch';
    return true;
  });
}

function openRoom(roomId) {
  const room = mobileConfig?.rooms?.find(r => r.id === roomId);
  if (!room) return;

  currentRoom = room;

  document.getElementById('room-title').textContent = room.name;
  showView('room');
  renderRoomDevices();
}

// ============================================
// DEVICE TILES
// ============================================

function renderRoomDevices() {
  const container = document.getElementById('room-devices');
  if (!container || !currentRoom) return;

  const devices = getRoomDevices(currentRoom);
  const filteredDevices = filterDevicesByCategory(devices);

  container.className = isListView ? 'room-devices room-devices--list' : 'room-devices';

  if (filteredDevices.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg class="empty-state__icon"><use href="#icon-lightbulb"/></svg>
        <div class="empty-state__title">No Devices</div>
        <div class="empty-state__message">No devices in this room</div>
      </div>
    `;
    return;
  }

  container.innerHTML = filteredDevices.map(device => {
    const state = deviceStates[device.entity_id] || {};
    const isOn = state.is_on || false;
    const brightness = state.brightness;
    const statusText = isOn
      ? (brightness !== undefined ? `${brightness}%` : 'On')
      : 'Off';

    if (isListView) {
      return renderDeviceListItem(device, state, isOn, statusText);
    } else {
      return renderDeviceTile(device, state, isOn, statusText);
    }
  }).join('');

  // Add event handlers
  setupDeviceInteractions(container);
}

function renderDeviceTile(device, state, isOn, statusText) {
  const colorDot = state.rgb_color
    ? `<div class="device-tile__color-dot" style="background: rgb(${state.rgb_color.join(',')})"></div>`
    : '';

  return `
    <div class="device-tile ${isOn ? 'device-tile--on' : ''}" data-entity="${device.entity_id}" data-type="${device.type}">
      <div class="device-tile__header">
        <div class="device-tile__icon">
          <svg class="icon"><use href="#icon-${device.icon || 'lightbulb'}"/></svg>
        </div>
        ${colorDot}
      </div>
      <div class="device-tile__info">
        <div class="device-tile__name">${device.name}</div>
        <div class="device-tile__status">${statusText}</div>
      </div>
    </div>
  `;
}

function renderDeviceListItem(device, state, isOn, statusText) {
  return `
    <div class="device-list-item ${isOn ? 'device-list-item--on' : ''}" data-entity="${device.entity_id}" data-type="${device.type}">
      <div class="device-list-item__icon">
        <svg class="icon"><use href="#icon-${device.icon || 'lightbulb'}"/></svg>
      </div>
      <div class="device-list-item__info">
        <div class="device-list-item__name">${device.name}</div>
        <div class="device-list-item__status">${statusText}</div>
      </div>
      <div class="device-list-item__toggle">
        <div class="toggle-switch ${isOn ? 'toggle-switch--on' : ''}" data-entity="${device.entity_id}">
          <div class="toggle-switch__thumb"></div>
        </div>
      </div>
    </div>
  `;
}

function setupDeviceInteractions(container) {
  // Grid tiles
  container.querySelectorAll('.device-tile').forEach(tile => {
    const entityId = tile.dataset.entity;
    const deviceType = tile.dataset.type;

    // Long press for control modal (lights only)
    if (deviceType === 'light') {
      tile.addEventListener('touchstart', (e) => {
        longPressTimer = setTimeout(() => {
          longPressTimer = null;
          openControlModal(entityId);
        }, 500);
      }, { passive: true });

      tile.addEventListener('touchend', (e) => {
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
          toggleDeviceState(entityId);
        }
      });

      tile.addEventListener('touchmove', () => {
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      }, { passive: true });
    } else {
      // Switches just toggle
      tile.addEventListener('click', () => toggleDeviceState(entityId));
    }
  });

  // List toggle switches
  container.querySelectorAll('.toggle-switch').forEach(toggle => {
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const entityId = toggle.dataset.entity;
      toggleDeviceState(entityId);
    });
  });

  // List items (click on row opens control for lights)
  container.querySelectorAll('.device-list-item').forEach(item => {
    const entityId = item.dataset.entity;
    const deviceType = item.dataset.type;

    item.addEventListener('click', (e) => {
      if (e.target.closest('.toggle-switch')) return;
      if (deviceType === 'light') {
        openControlModal(entityId);
      }
    });
  });
}

// ============================================
// DEVICE CONTROL
// ============================================

async function fetchAllDeviceStates() {
  const devices = mobileConfig?.devices || {};

  for (const entityId of Object.keys(devices)) {
    try {
      const state = await fetchDeviceState(entityId);
      deviceStates[entityId] = state;
    } catch (error) {
      console.error(`Error fetching ${entityId}:`, error);
    }
  }

  // Update UI
  renderRooms();
  if (currentRoom) {
    renderRoomDevices();
  }
  if (currentDevice) {
    updateControlModalState();
  }
}

async function toggleDeviceState(entityId) {
  const device = mobileConfig?.devices?.[entityId];
  if (!device) return;

  const state = deviceStates[entityId];
  const isOn = state?.is_on || false;
  const domain = device.type === 'light' ? 'light' : 'switch';

  // Optimistic update
  deviceStates[entityId] = { ...state, is_on: !isOn };
  renderRooms();
  if (currentRoom) renderRoomDevices();

  try {
    if (isOn) {
      await turnOff(entityId, domain);
    } else {
      await turnOn(entityId, domain);
    }
    // Refresh state
    const newState = await fetchDeviceState(entityId);
    deviceStates[entityId] = newState;
  } catch (error) {
    console.error(`Error toggling ${entityId}:`, error);
    // Revert optimistic update
    deviceStates[entityId] = state;
  }

  renderRooms();
  if (currentRoom) renderRoomDevices();
}

// ============================================
// CONTROL MODAL
// ============================================

function setupControlModal() {
  const modal = document.getElementById('control-modal');
  const backdrop = modal?.querySelector('.modal__backdrop');
  const closeBtn = document.getElementById('control-modal-close');

  backdrop?.addEventListener('click', closeControlModal);
  closeBtn?.addEventListener('click', closeControlModal);

  // Power toggle
  document.getElementById('power-toggle')?.addEventListener('click', () => {
    if (currentDevice) {
      toggleDeviceState(currentDevice);
    }
  });

  // Brightness slider
  setupBrightnessSlider();

  // Color temperature slider
  setupColorTempSlider();

  // Color wheel
  setupColorWheel();

  // Hex input
  document.getElementById('hex-apply')?.addEventListener('click', applyHexColor);
  document.getElementById('hex-input')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') applyHexColor();
  });

  // Palette add
  document.getElementById('palette-add')?.addEventListener('click', addCurrentColorToPalette);
}

function openControlModal(entityId) {
  currentDevice = entityId;

  const device = mobileConfig?.devices?.[entityId];
  if (!device) return;

  const state = deviceStates[entityId] || {};

  // Set title
  document.getElementById('control-modal-title').textContent = device.name;

  // Update power toggle
  updatePowerToggle(state.is_on);

  // Show/hide sections based on device capabilities
  const supportsColor = device.supports_color || false;
  const supportsColorTemp = device.supports_color_temp || false;

  document.getElementById('brightness-section').style.display = 'block';
  document.getElementById('color-temp-section').style.display = supportsColorTemp ? 'block' : 'none';
  document.getElementById('color-picker-section').style.display = supportsColor ? 'block' : 'none';
  document.getElementById('palette-section').style.display = supportsColor ? 'block' : 'none';

  // Update brightness
  updateBrightnessUI(state.brightness || 100);

  // Update color temp
  if (supportsColorTemp && state.color_temp) {
    updateColorTempUI(state.color_temp);
  }

  // Update color
  if (supportsColor) {
    initColorWheel();
    if (state.rgb_color) {
      updateColorFromRGB(state.rgb_color);
    }
    renderPalette();
  }

  // Show modal
  const modal = document.getElementById('control-modal');
  modal?.classList.add('modal--active');
}

function closeControlModal() {
  const modal = document.getElementById('control-modal');
  modal?.classList.remove('modal--active');
  currentDevice = null;
}

function updateControlModalState() {
  if (!currentDevice) return;

  const state = deviceStates[currentDevice];
  if (!state) return;

  updatePowerToggle(state.is_on);
  updateBrightnessUI(state.brightness || 100);
}

function updatePowerToggle(isOn) {
  const toggle = document.getElementById('power-toggle');
  const label = document.getElementById('power-toggle-label');

  toggle?.classList.toggle('power-toggle--on', isOn);
  if (label) label.textContent = isOn ? 'On' : 'Off';
}

// ============================================
// BRIGHTNESS SLIDER
// ============================================

function setupBrightnessSlider() {
  const track = document.querySelector('.brightness-slider__track');
  if (!track) return;

  let isDragging = false;

  const handleMove = (clientX) => {
    const rect = track.getBoundingClientRect();
    const percent = Math.max(1, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    updateBrightnessUI(percent);
  };

  const handleEnd = async (clientX) => {
    const rect = track.getBoundingClientRect();
    const percent = Math.max(1, Math.min(100, ((clientX - rect.left) / rect.width) * 100));

    if (currentDevice) {
      try {
        await setBrightness(currentDevice, Math.round(percent));
        const state = await fetchDeviceState(currentDevice);
        deviceStates[currentDevice] = state;
        if (currentRoom) renderRoomDevices();
      } catch (error) {
        console.error('Error setting brightness:', error);
      }
    }
  };

  track.addEventListener('touchstart', (e) => {
    isDragging = true;
    handleMove(e.touches[0].clientX);
  }, { passive: true });

  track.addEventListener('touchmove', (e) => {
    if (isDragging) handleMove(e.touches[0].clientX);
  }, { passive: true });

  track.addEventListener('touchend', (e) => {
    if (isDragging) {
      isDragging = false;
      handleEnd(e.changedTouches[0].clientX);
    }
  });

  // Mouse events for desktop testing
  track.addEventListener('mousedown', (e) => {
    isDragging = true;
    handleMove(e.clientX);
  });

  document.addEventListener('mousemove', (e) => {
    if (isDragging) handleMove(e.clientX);
  });

  document.addEventListener('mouseup', (e) => {
    if (isDragging) {
      isDragging = false;
      handleEnd(e.clientX);
    }
  });
}

function updateBrightnessUI(percent) {
  const fill = document.getElementById('brightness-fill');
  const thumb = document.getElementById('brightness-thumb');
  const value = document.getElementById('brightness-value');

  if (fill) fill.style.width = `${percent}%`;
  if (thumb) thumb.style.left = `${percent}%`;
  if (value) value.textContent = `${Math.round(percent)}%`;
}

// ============================================
// COLOR TEMPERATURE SLIDER
// ============================================

function setupColorTempSlider() {
  const track = document.querySelector('.color-temp-slider__track');
  if (!track) return;

  let isDragging = false;

  const handleMove = (clientX) => {
    const rect = track.getBoundingClientRect();
    const percent = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    updateColorTempThumb(percent);
  };

  const handleEnd = async (clientX) => {
    const rect = track.getBoundingClientRect();
    const percent = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));

    // Convert percent to mireds (153-500 typical range)
    // 0% = warm (500 mireds), 100% = cool (153 mireds)
    const mireds = Math.round(500 - (percent / 100) * (500 - 153));

    if (currentDevice) {
      try {
        await setColorTemp(currentDevice, mireds);
        const state = await fetchDeviceState(currentDevice);
        deviceStates[currentDevice] = state;
        if (currentRoom) renderRoomDevices();
      } catch (error) {
        console.error('Error setting color temp:', error);
      }
    }
  };

  track.addEventListener('touchstart', (e) => {
    isDragging = true;
    handleMove(e.touches[0].clientX);
  }, { passive: true });

  track.addEventListener('touchmove', (e) => {
    if (isDragging) handleMove(e.touches[0].clientX);
  }, { passive: true });

  track.addEventListener('touchend', (e) => {
    if (isDragging) {
      isDragging = false;
      handleEnd(e.changedTouches[0].clientX);
    }
  });
}

function updateColorTempUI(mireds) {
  // Convert mireds to percent (153-500 range)
  const percent = ((500 - mireds) / (500 - 153)) * 100;
  updateColorTempThumb(percent);
}

function updateColorTempThumb(percent) {
  const thumb = document.getElementById('color-temp-thumb');
  if (thumb) thumb.style.left = `${percent}%`;
}

// ============================================
// COLOR WHEEL
// ============================================

function initColorWheel() {
  const canvas = document.getElementById('color-wheel');
  if (!canvas) return;

  colorWheelCtx = canvas.getContext('2d');
  const size = canvas.width;
  const centerX = size / 2;
  const centerY = size / 2;
  const radius = size / 2 - 10;

  // Draw color wheel
  const imageData = colorWheelCtx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - centerX;
      const dy = y - centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance <= radius) {
        const angle = Math.atan2(dy, dx);
        const hue = ((angle + Math.PI) / (2 * Math.PI)) * 360;
        const saturation = (distance / radius) * 100;
        const rgb = hslToRgb(hue, saturation, 50);

        const index = (y * size + x) * 4;
        imageData.data[index] = rgb[0];
        imageData.data[index + 1] = rgb[1];
        imageData.data[index + 2] = rgb[2];
        imageData.data[index + 3] = 255;
      }
    }
  }

  colorWheelCtx.putImageData(imageData, 0, 0);
}

function setupColorWheel() {
  const canvas = document.getElementById('color-wheel');
  if (!canvas) return;

  const handleColorPick = (clientX, clientY) => {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = canvas.width / 2 - 10;

    const dx = x - centerX;
    const dy = y - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance <= radius) {
      const angle = Math.atan2(dy, dx);
      const hue = ((angle + Math.PI) / (2 * Math.PI)) * 360;
      const saturation = Math.min(100, (distance / radius) * 100);
      const rgb = hslToRgb(hue, saturation, 50);

      updateColorPreview(rgb);
      updateHexInput(rgb);
    }
  };

  const handleColorEnd = async (clientX, clientY) => {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = canvas.width / 2 - 10;

    const dx = x - centerX;
    const dy = y - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance <= radius) {
      const angle = Math.atan2(dy, dx);
      const hue = ((angle + Math.PI) / (2 * Math.PI)) * 360;
      const saturation = Math.min(100, (distance / radius) * 100);
      const rgb = hslToRgb(hue, saturation, 50);

      if (currentDevice) {
        try {
          await setLightColor(currentDevice, rgb);
          const state = await fetchDeviceState(currentDevice);
          deviceStates[currentDevice] = state;
          if (currentRoom) renderRoomDevices();
        } catch (error) {
          console.error('Error setting color:', error);
        }
      }
    }
  };

  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    handleColorPick(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });

  canvas.addEventListener('touchend', (e) => {
    handleColorEnd(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
  });

  // Mouse events for desktop testing
  let isMouseDown = false;

  canvas.addEventListener('mousedown', (e) => {
    isMouseDown = true;
    handleColorPick(e.clientX, e.clientY);
  });

  canvas.addEventListener('mousemove', (e) => {
    if (isMouseDown) handleColorPick(e.clientX, e.clientY);
  });

  canvas.addEventListener('mouseup', (e) => {
    if (isMouseDown) {
      isMouseDown = false;
      handleColorEnd(e.clientX, e.clientY);
    }
  });

  canvas.addEventListener('mouseleave', () => {
    isMouseDown = false;
  });
}

function updateColorFromRGB(rgb) {
  updateColorPreview(rgb);
  updateHexInput(rgb);
}

function updateColorPreview(rgb) {
  const preview = document.getElementById('color-preview');
  if (preview) {
    preview.style.background = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  }
}

function updateHexInput(rgb) {
  const input = document.getElementById('hex-input');
  if (input) {
    input.value = rgbToHex(rgb);
  }
}

async function applyHexColor() {
  const input = document.getElementById('hex-input');
  if (!input || !currentDevice) return;

  let hex = input.value.trim();
  if (!hex.startsWith('#')) hex = '#' + hex;

  // Validate hex
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) {
    input.classList.add('error');
    setTimeout(() => input.classList.remove('error'), 500);
    return;
  }

  const rgb = hexToRgb(hex);
  updateColorPreview(rgb);

  try {
    await setLightColor(currentDevice, rgb);
    const state = await fetchDeviceState(currentDevice);
    deviceStates[currentDevice] = state;
    if (currentRoom) renderRoomDevices();
  } catch (error) {
    console.error('Error setting color:', error);
  }
}

// ============================================
// COLOR PALETTE
// ============================================

function renderPalette() {
  const container = document.getElementById('color-palette');
  if (!container) return;

  const palette = mobileConfig?.colorPalette || [];

  container.innerHTML = palette.map((color, index) => `
    <div class="palette-color" data-index="${index}" style="background: ${color.hex}">
      <button class="palette-color__delete" data-index="${index}">
        <svg class="icon icon--sm"><use href="#icon-x"/></svg>
      </button>
    </div>
  `).join('');

  // Add click handlers
  container.querySelectorAll('.palette-color').forEach(swatch => {
    swatch.addEventListener('click', (e) => {
      if (e.target.closest('.palette-color__delete')) return;

      const index = parseInt(swatch.dataset.index);
      const color = palette[index];
      if (color) {
        applyPaletteColor(color.hex);
      }
    });

    // Long press to delete
    let deleteTimer;
    swatch.addEventListener('touchstart', () => {
      deleteTimer = setTimeout(() => {
        swatch.classList.add('palette-color--editing');
      }, 500);
    }, { passive: true });

    swatch.addEventListener('touchend', () => {
      clearTimeout(deleteTimer);
      setTimeout(() => swatch.classList.remove('palette-color--editing'), 2000);
    });
  });

  // Delete buttons
  container.querySelectorAll('.palette-color__delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const index = parseInt(btn.dataset.index);
      deletePaletteColor(index);
    });
  });
}

async function applyPaletteColor(hex) {
  if (!currentDevice) return;

  const rgb = hexToRgb(hex);
  updateColorPreview(rgb);
  updateHexInput(rgb);

  try {
    await setLightColor(currentDevice, rgb);
    const state = await fetchDeviceState(currentDevice);
    deviceStates[currentDevice] = state;
    if (currentRoom) renderRoomDevices();
  } catch (error) {
    console.error('Error setting color:', error);
  }
}

function addCurrentColorToPalette() {
  const input = document.getElementById('hex-input');
  if (!input) return;

  let hex = input.value.trim();
  if (!hex.startsWith('#')) hex = '#' + hex;

  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return;

  if (!mobileConfig.colorPalette) {
    mobileConfig.colorPalette = [];
  }

  // Check if color already exists
  if (mobileConfig.colorPalette.some(c => c.hex.toLowerCase() === hex.toLowerCase())) {
    return;
  }

  mobileConfig.colorPalette.push({
    name: `Color ${mobileConfig.colorPalette.length + 1}`,
    hex: hex
  });

  renderPalette();
  savePalette();
}

function deletePaletteColor(index) {
  if (!mobileConfig?.colorPalette) return;

  mobileConfig.colorPalette.splice(index, 1);
  renderPalette();
  savePalette();
}

function savePalette() {
  // Save to localStorage for persistence
  try {
    localStorage.setItem('skylight-palette', JSON.stringify(mobileConfig.colorPalette));
  } catch (e) {
    console.error('Error saving palette:', e);
  }
}

function loadPalette() {
  try {
    const saved = localStorage.getItem('skylight-palette');
    if (saved) {
      mobileConfig.colorPalette = JSON.parse(saved);
    }
  } catch (e) {
    console.error('Error loading palette:', e);
  }
}

// ============================================
// WIDGETS (using shared/widgets.js)
// ============================================

async function fetchWeather() {
  const config = {
    weather: mobileConfig?.weather || CONFIG?.weather
  };
  await WeatherWidget.fetch(config);
  const container = document.getElementById('weather-widget');
  if (container) {
    WeatherWidget.render(container, config);
  }
}

async function fetchNotifications() {
  const config = {
    apiUrl: mobileConfig?.apis?.notifications || CONFIG?.apis?.notifications
  };
  await NotificationsWidget.fetch(config);
  const container = document.getElementById('notifications-widget');
  if (container) {
    NotificationsWidget.render(container);
  }
}

async function fetchShipments() {
  const config = {
    apiKey: mobileConfig?.apis?.aftership_key || CONFIG?.apis?.aftership_key,
    apiUrl: mobileConfig?.apis?.aftership || CONFIG?.apis?.aftership
  };
  await ShippingWidget.fetch(config);
  const container = document.getElementById('shipping-widget');
  if (container) {
    ShippingWidget.render(container, { maxItems: 3 });
  }
}

// ============================================
// CONNECTION STATUS
// ============================================

function updateConnectionStatus(connected) {
  const banner = document.getElementById('connection-status');
  if (!banner) return;

  if (connected) {
    banner.classList.add('connection-status--hidden');
  } else {
    banner.classList.remove('connection-status--hidden');
    banner.classList.remove('connection-status--connected');
  }
}

// ============================================
// SERVICE WORKER REGISTRATION
// ============================================

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(reg => console.log('Service worker registered'))
      .catch(err => console.error('Service worker registration failed:', err));
  });
}

// ============================================
// START APP
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  // Load saved palette first
  loadPalette();
  init();
});
