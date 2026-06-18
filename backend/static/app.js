/**
 * Skylight Home Admin - Frontend
 * Mobile PWA for managing dashboard content:
 * Gallery (photos), Memo, List, Movie Night, Home Assistant
 */

'use strict';

// ============================================
// CONFIG & STATE
// ============================================

const API_BASE = ''; // Same origin as backend

let state = {
  photos: [],
  memo: null,
  listItems: [],
  movie: null,
  displayOverride: null,
  haConfig: null,
  haDevices: [],
};

let dragState = { dragging: false, sourceId: null };
let editingListItemId = null;
let deletingPhotoId = null;
let deletingHaDeviceId = null;
let validatedMovieData = null; // Set when a TMDB result is selected
let forceSaveMovie = false;    // Set after warning shown, user presses Save again

// ============================================
// INITIALIZATION
// ============================================

async function init() {
  setupNavigation();
  await Promise.all([
    fetchPhotos(),
    fetchMemo(),
    fetchListItems(),
    fetchMovie(),
    fetchDisplayOverride(),
    fetchHaConfig(),
    fetchHaDevices(),
  ]);
  renderGallery();
  renderMemo();
  renderList();
  renderMovie();
  renderDisplayOverride();
  renderHaConfig();
  renderHaDevices();
  renderHaScenes();
  registerServiceWorker();
}

// ============================================
// NAVIGATION
// ============================================

function setupNavigation() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  });
}

function switchView(viewName) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('view--active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('tab--active'));

  const view = document.getElementById(`view-${viewName}`);
  if (view) view.classList.add('view--active');

  const tab = document.querySelector(`.tab[data-view="${viewName}"]`);
  if (tab) tab.classList.add('tab--active');
}

// ============================================
// TOAST NOTIFICATIONS
// ============================================

function showToast(message, duration = 2500) {
  const toast = document.getElementById('toast');
  const msgEl = document.getElementById('toast-message');
  msgEl.textContent = message;
  toast.style.display = 'block';
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => { toast.style.display = 'none'; }, duration);
}

// ============================================
// MODALS
// ============================================

function showModal(id) {
  document.getElementById(id).style.display = 'flex';
}

function hideModal(id) {
  document.getElementById(id).style.display = 'none';
}

function setupModals() {
  // Photo delete modal
  document.querySelector('#modal-photo-delete .modal-backdrop')?.addEventListener('click', () => hideModal('modal-photo-delete'));
  document.querySelector('#modal-photo-delete .modal-cancel')?.addEventListener('click', () => hideModal('modal-photo-delete'));
  document.querySelector('#modal-photo-delete .modal-confirm-delete')?.addEventListener('click', confirmDeletePhoto);

  // HA device delete modal
  document.querySelector('#modal-ha-delete .modal-backdrop')?.addEventListener('click', () => hideModal('modal-ha-delete'));
  document.querySelector('#modal-ha-delete .modal-cancel')?.addEventListener('click', () => hideModal('modal-ha-delete'));
  document.querySelector('#modal-ha-delete .modal-confirm-ha-delete')?.addEventListener('click', confirmDeleteHaDevice);

  // List edit modal
  document.querySelector('#modal-list-edit .modal-backdrop')?.addEventListener('click', () => hideModal('modal-list-edit'));
  document.querySelector('#modal-list-edit .modal-cancel')?.addEventListener('click', () => hideModal('modal-list-edit'));
  document.querySelector('#modal-list-edit .modal-confirm-edit')?.addEventListener('click', confirmEditListItem);

  // List add modal
  document.querySelector('#modal-list-add .modal-backdrop')?.addEventListener('click', () => hideModal('modal-list-add'));
  document.querySelector('#modal-list-add .modal-cancel')?.addEventListener('click', () => hideModal('modal-list-add'));
  document.querySelector('#modal-list-add .modal-confirm-add')?.addEventListener('click', confirmAddListItem);
}

// ============================================
// GALLERY (PHOTOS)
// ============================================

async function fetchPhotos() {
  try {
    const res = await fetch(`${API_BASE}/api/photos`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.photos = await res.json();
  } catch (e) { console.error('Fetch photos error:', e); }
}

function renderGallery() {
  const grid = document.getElementById('gallery-grid');
  const empty = document.getElementById('gallery-empty');

  if (!state.photos.length) {
    grid.innerHTML = '';
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';
  grid.innerHTML = state.photos.map(photo => `
    <div class="gallery-item" data-id="${photo.id}" draggable="true">
      <img src="/photos/${photo.filename}" alt="${photo.original_name}" loading="lazy">
      <div class="gallery-item__overlay"></div>
      <button class="gallery-item__delete" data-id="${photo.id}" aria-label="Delete photo">
        <svg class="icon icon--sm"><use href="#icon-x"/></svg>
      </button>
      <svg class="icon icon--sm gallery-item__drag-handle"><use href="#icon-drag"/></svg>
    </div>
  `).join('');

  setupGalleryInteractions();
}

function setupGalleryInteractions() {
  // Delete buttons
  document.querySelectorAll('.gallery-item__delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deletingPhotoId = parseInt(btn.dataset.id);
      showModal('modal-photo-delete');
    });
  });

  // Drag and drop for reordering
  let dragSourceId = null;

  document.querySelectorAll('.gallery-item').forEach(item => {
    item.addEventListener('dragstart', (e) => {
      dragSourceId = parseInt(item.dataset.id);
      item.classList.add('gallery-item--dragging');
      e.dataTransfer.effectAllowed = 'move';
      // Required for iOS Safari
      e.dataTransfer.setData('text/plain', item.dataset.id);
    });

    item.addEventListener('dragend', () => {
      item.classList.remove('gallery-item--dragging');
      document.querySelectorAll('.gallery-item').forEach(i => i.classList.remove('gallery-item--drag-over'));
      dragSourceId = null;
    });

    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      item.classList.add('gallery-item--drag-over');
    });

    item.addEventListener('dragleave', () => {
      item.classList.remove('gallery-item--drag-over');
    });

    item.addEventListener('drop', async (e) => {
      e.preventDefault();
      item.classList.remove('gallery-item--drag-over');

      const targetId = parseInt(item.dataset.id);
      if (dragSourceId === null || dragSourceId === targetId) return;

      // Reorder the array
      const ids = [...state.photos.map(p => p.id)];
      const fromIndex = ids.indexOf(dragSourceId);
      const toIndex = ids.indexOf(targetId);

      if (fromIndex === -1 || toIndex === -1) return;

      const [moved] = ids.splice(fromIndex, 1);
      ids.splice(toIndex, 0, moved);

      try {
        const res = await fetch(`${API_BASE}/api/photos/reorder`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order: ids }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        state.photos = await res.json();
        renderGallery();
      } catch (err) {
        console.error('Reorder error:', err);
        showToast('Failed to reorder');
      }
    });
  });

  // Touch-based drag for mobile
  setupTouchDrag(grid);
}

/**
 * Touch-based drag and drop for mobile browsers.
 * Uses a long-press to initiate drag, then follows finger movement.
 */
function setupTouchDrag(container) {
  if (container._touchDragBound) return;
  container._touchDragBound = true;
  let touchDragItem = null;
  let touchDragClone = null;
  let touchStartX, touchStartY;
  let hasMoved = false;

  container.addEventListener('touchstart', (e) => {
    const item = e.target.closest('.gallery-item');
    if (!item || e.target.closest('.gallery-item__delete')) return;

    touchDragItem = item;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    hasMoved = false;

    // Long press to start drag
    item._longPressTimer = setTimeout(() => {
      if (!hasMoved && touchDragItem === item) {
        startTouchDrag(item);
      }
    }, 400);
  }, { passive: true });

  container.addEventListener('touchmove', (e) => {
    if (!touchDragItem) return;

    const dx = Math.abs(e.touches[0].clientX - touchStartX);
    const dy = Math.abs(e.touches[0].clientY - touchStartY);

    if (dx > 10 || dy > 10) {
      hasMoved = true;
      clearTimeout(touchDragItem._longPressTimer);
    }

    if (touchDragClone) {
      e.preventDefault();
      moveTouchDragClone(e.touches[0]);
    }
  }, { passive: false });

  container.addEventListener('touchend', (e) => {
    clearTimeout(touchDragItem?._longPressTimer);

    if (touchDragClone) {
      endTouchDrag();
    }

    touchDragItem = null;
  });
}

function startTouchDrag(item) {
  // Create floating clone
  const rect = item.getBoundingClientRect();
  touchDragClone = item.cloneNode(true);
  touchDragClone.style.cssText = `
    position: fixed;
    width: ${rect.width}px;
    height: ${rect.height}px;
    z-index: 9999;
    pointer-events: none;
    opacity: 0.85;
    border-radius: var(--radius-md);
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    left: ${rect.left}px;
    top: ${rect.top}px;
  `;
  document.body.appendChild(touchDragClone);
  item.classList.add('gallery-item--dragging');
}

function moveTouchDragClone(touch) {
  if (!touchDragClone) return;
  const cloneRect = touchDragClone.getBoundingClientRect();
  const offsetX = cloneRect.width / 2;
  const offsetY = cloneRect.height / 2;
  touchDragClone.style.left = `${touch.clientX - offsetX}px`;
  touchDragClone.style.top = `${touch.clientY - offsetY}px`;

  // Highlight drop target
  document.querySelectorAll('.gallery-item').forEach(i => i.classList.remove('gallery-item--drag-over'));
  const target = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('.gallery-item');
  if (target && target !== touchDragItem) {
    target.classList.add('gallery-item--drag-over');
  }
}

async function endTouchDrag() {
  const cloneRect = touchDragClone.getBoundingClientRect();
  const centerX = cloneRect.left + cloneRect.width / 2;
  const centerY = cloneRect.top + cloneRect.height / 2;

  touchDragClone.remove();
  touchDragClone = null;

  document.querySelectorAll('.gallery-item').forEach(i => {
    i.classList.remove('gallery-item--dragging');
    i.classList.remove('gallery-item--drag-over');
  });

  const target = document.elementFromPoint(centerX, centerY)?.closest('.gallery-item');
  if (!target || !touchDragItem) return;

  const sourceId = parseInt(touchDragItem.dataset.id);
  const targetId = parseInt(target.dataset.id);
  touchDragItem = null;

  if (sourceId === targetId) return;

  const ids = [...state.photos.map(p => p.id)];
  const fromIndex = ids.indexOf(sourceId);
  const toIndex = ids.indexOf(targetId);

  if (fromIndex === -1 || toIndex === -1) return;

  const [moved] = ids.splice(fromIndex, 1);
  ids.splice(toIndex, 0, moved);

  try {
    const res = await fetch(`${API_BASE}/api/photos/reorder`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: ids }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.photos = await res.json();
    renderGallery();
  } catch (err) {
    console.error('Reorder error:', err);
    showToast('Failed to reorder');
  }
}

// Photo upload handler
document.getElementById('photo-upload-input')?.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  if (!files.length) return;

  for (const file of files) {
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${API_BASE}/api/photos/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) throw new Error(await res.text());

      const photo = await res.json();
      state.photos.push(photo);
      showToast(`"${file.name}" uploaded`);
    } catch (err) {
      console.error('Upload error:', err);
      showToast('Upload failed');
    }
  }

  renderGallery();
  e.target.value = ''; // Reset input
});

async function confirmDeletePhoto() {
  hideModal('modal-photo-delete');
  if (deletingPhotoId == null) return;

  try {
    const res = await fetch(`${API_BASE}/api/photos/${deletingPhotoId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete failed');

    state.photos = state.photos.filter(p => p.id !== deletingPhotoId);
    renderGallery();
    showToast('Photo deleted');
  } catch (err) {
    console.error('Delete error:', err);
    showToast('Delete failed');
  } finally {
    deletingPhotoId = null;
  }
}

// ============================================
// MEMO
// ============================================

async function fetchMemo() {
  try {
    const res = await fetch(`${API_BASE}/api/memo`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.memo = await res.json();
  } catch (e) { console.error('Fetch memo error:', e); }
}

function renderMemo() {
  if (!state.memo) return;

  const titleInput = document.getElementById('memo-title');
  const contentInput = document.getElementById('memo-content');

  titleInput.value = state.memo.title;
  contentInput.value = state.memo.content;
}

document.getElementById('memo-save-btn')?.addEventListener('click', async () => {
  const title = document.getElementById('memo-title').value.trim();
  const content = document.getElementById('memo-content').value;

  try {
    const res = await fetch(`${API_BASE}/api/memo`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content }),
    });

    if (!res.ok) throw new Error('Save failed');

    state.memo = await res.json();
    showToast('Memo saved');
  } catch (err) {
    console.error('Save memo error:', err);
    showToast('Save failed');
  }
});

// ============================================
// LIST ITEMS
// ============================================

async function fetchListItems() {
  try {
    const res = await fetch(`${API_BASE}/api/list-items`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.listItems = await res.json();
  } catch (e) { console.error('Fetch list error:', e); }
}

function renderList() {
  const container = document.getElementById('list-items');
  const empty = document.getElementById('list-empty');

  if (!state.listItems.length) {
    container.innerHTML = '';
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';
  container.innerHTML = state.listItems.map(item => `
    <li class="list-item ${item.completed ? 'list-item--completed' : ''}" data-id="${item.id}">
      <div class="list-item__checkbox ${item.completed ? 'list-item__checkbox--checked' : ''}" data-id="${item.id}">
        <svg class="icon icon--xs" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <span class="list-item__text">${escapeHtml(item.text)}</span>
      <div class="list-item__actions">
        <button class="list-item__action-btn" data-edit-id="${item.id}" aria-label="Edit item">
          <svg class="icon icon--sm"><use href="#icon-edit"/></svg>
        </button>
        <button class="list-item__action-btn list-item__action-btn--delete" data-delete-id="${item.id}" aria-label="Delete item">
          <svg class="icon icon--sm"><use href="#icon-trash"/></svg>
        </button>
      </div>
    </li>
  `).join('');

  setupListInteractions();
}

function setupListInteractions() {
  // Toggle completion
  document.querySelectorAll('.list-item__checkbox').forEach(cb => {
    cb.addEventListener('click', async () => {
      const id = parseInt(cb.dataset.id);
      const item = state.listItems.find(i => i.id === id);
      if (!item) return;

      try {
        const res = await fetch(`${API_BASE}/api/list-items/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ completed: !item.completed }),
        });
        const updated = await res.json();
        Object.assign(item, updated);
        renderList();
      } catch (err) {
        console.error('Toggle error:', err);
        showToast('Update failed');
      }
    });
  });

  // Edit button
  document.querySelectorAll('[data-edit-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      editingListItemId = parseInt(btn.dataset.editId);
      const item = state.listItems.find(i => i.id === editingListItemId);
      if (item) {
        document.getElementById('list-edit-input').value = item.text;
        showModal('modal-list-edit');
        setTimeout(() => document.getElementById('list-edit-input').focus(), 300);
      }
    });
  });

  // Delete button
  document.querySelectorAll('[data-delete-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.dataset.deleteId);
      try {
        const res = await fetch(`${API_BASE}/api/list-items/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Delete failed');

        state.listItems = state.listItems.filter(i => i.id !== id);
        renderList();
        showToast('Item deleted');
      } catch (err) {
        console.error('Delete error:', err);
        showToast('Delete failed');
      }
    });
  });
}

// Add new list item
document.getElementById('list-add-btn')?.addEventListener('click', () => {
  showModal('modal-list-add');
  setTimeout(() => document.getElementById('list-add-input').focus(), 300);
});

// Display override cards
document.querySelectorAll('.display-card').forEach(card => {
  card.addEventListener('click', async () => {
    const screen = card.dataset.screen;
    const screenValue = screen === 'auto' ? null : screen;

    // Update UI immediately
    document.querySelectorAll('.display-card').forEach(c => c.classList.remove('display-card--active'));
    card.classList.add('display-card--active');

    try {
      const res = await fetch(`${API_BASE}/api/display-override`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ screen: screenValue }),
      });
      if (!res.ok) throw new Error('Update failed');
      state.displayOverride = screenValue;
      updateDisplayCurrentText(screenValue);
      showToast(screenValue ? `Showing ${screenValue}` : 'Auto mode restored');
    } catch (err) {
      console.error('Display override error:', err);
      showToast('Failed to update display');
    }
  });
});

async function confirmAddListItem() {
  const input = document.getElementById('list-add-input');
  const text = input.value.trim();
  if (!text) return;

  hideModal('modal-list-add');

  try {
    const res = await fetch(`${API_BASE}/api/list-items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) throw new Error('Create failed');

    const item = await res.json();
    state.listItems.push(item);
    renderList();
    showToast('Item added');
  } catch (err) {
    console.error('Add item error:', err);
    showToast('Failed to add item');
  } finally {
    input.value = '';
  }
}

async function confirmEditListItem() {
  const input = document.getElementById('list-edit-input');
  const text = input.value.trim();
  if (!text) return;

  hideModal('modal-list-edit');

  try {
    const res = await fetch(`${API_BASE}/api/list-items/${editingListItemId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) throw new Error('Update failed');

    const updated = await res.json();
    const item = state.listItems.find(i => i.id === editingListItemId);
    if (item) Object.assign(item, updated);

    renderList();
    showToast('Item updated');
  } catch (err) {
    console.error('Edit error:', err);
    showToast('Update failed');
  } finally {
    editingListItemId = null;
  }
}

// ============================================
// MOVIE
// ============================================

async function fetchMovie() {
  try {
    const res = await fetch(`${API_BASE}/api/movie`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.movie = await res.json();
  } catch (e) { console.error('Fetch movie error:', e); }
}

function renderMovie() {
  if (!state.movie) return;

  const titleInput = document.getElementById('movie-title');
  const yearInput = document.getElementById('movie-year');
  const posterUrlInput = document.getElementById('movie-poster-url');
  const ratingInput = document.getElementById('movie-rating');
  const blurbInput = document.getElementById('movie-blurb');
  const posterImg = document.getElementById('movie-poster-img');
  const posterPlaceholder = document.getElementById('movie-poster-placeholder');

  titleInput.value = state.movie.title;
  yearInput.value = state.movie.year ?? '';
  posterUrlInput.value = state.movie.poster_url ?? '';
  ratingInput.value = state.movie.rating ?? '';
  blurbInput.value = state.movie.blurb;

  updatePosterPreview(state.movie.poster_url);

  // Reset validation state on load
  validatedMovieData = null;
  forceSaveMovie = false;
  document.getElementById('movie-validation-warning').style.display = 'none';
}

function updatePosterPreview(url) {
  const img = document.getElementById('movie-poster-img');
  const placeholder = document.getElementById('movie-poster-placeholder');

  if (url) {
    img.src = url;
    img.hidden = false;
    placeholder.style.display = 'none';
  } else {
    img.hidden = true;
    img.src = '';
    placeholder.style.display = 'flex';
  }
}

// Movie search
document.getElementById('movie-search-btn')?.addEventListener('click', searchMovie);
document.getElementById('movie-search-input')?.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') searchMovie();
});

async function searchMovie() {
  const query = document.getElementById('movie-search-input').value.trim();
  if (!query) return;

  const resultsContainer = document.getElementById('movie-search-results');

  try {
    const res = await fetch(`${API_BASE}/api/movie/search?query=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error(await res.text());

    const data = await res.json();

    if (!data.results.length) {
      resultsContainer.innerHTML = '<div class="search-result-item"><span style="color:var(--text-muted)">No movies found</span></div>';
      resultsContainer.style.display = 'block';
      return;
    }

    resultsContainer.innerHTML = data.results.map(movie => `
      <div class="search-result-item" data-tmdb-id="${movie.id}">
        ${movie.poster_url
          ? `<img class="search-result-item__poster" src="${movie.poster_url}" alt="">`
          : `<div class="search-result-item__poster"></div>`
        }
        <div class="search-result-item__info">
          <div class="search-result-item__title">${escapeHtml(movie.title)}</div>
          <div class="search-result-item__year">${movie.year || 'N/A'}${movie.rating ? ` · ★ ${movie.rating.toFixed(1)}` : ''}</div>
        </div>
      </div>
    `).join('');

    resultsContainer.style.display = 'block';

    // Click handler for each result
    resultsContainer.querySelectorAll('.search-result-item[data-tmdb-id]').forEach(el => {
      el.addEventListener('click', () => selectMovieResult(data.results.find(m => m.id === parseInt(el.dataset.tmdbId))));
    });

  } catch (err) {
    console.error('Search error:', err);
    showToast(err.message.includes('TMDB_API_KEY') ? 'TMDB API key not configured' : 'Search failed');
  }
}

function selectMovieResult(movie) {
  if (!movie) return;

  document.getElementById('movie-title').value = movie.title;
  document.getElementById('movie-year').value = movie.year ?? '';
  document.getElementById('movie-poster-url').value = movie.poster_url ?? '';
  document.getElementById('movie-rating').value = movie.rating ?? '';
  document.getElementById('movie-blurb').value = movie.overview;

  updatePosterPreview(movie.poster_url);

  // Store as validated
  validatedMovieData = {
    tmdb_id: movie.id,
    title: movie.title,
    year: movie.year,
    poster_url: movie.poster_url,
    rating: movie.rating,
    blurb: movie.overview,
    validated: true,
  };

  // Hide warning and reset force save
  document.getElementById('movie-validation-warning').style.display = 'none';
  forceSaveMovie = false;

  // Close results
  document.getElementById('movie-search-results').style.display = 'none';
  document.getElementById('movie-search-input').value = '';

  showToast(`Selected "${movie.title}"`);
}

// Movie save with validation
document.getElementById('movie-save-btn')?.addEventListener('click', async () => {
  const title = document.getElementById('movie-title').value.trim();
  const year = document.getElementById('movie-year').value ? parseInt(document.getElementById('movie-year').value) : null;
  const posterUrl = document.getElementById('movie-poster-url').value.trim() || null;
  const rating = document.getElementById('movie-rating').value ? parseFloat(document.getElementById('movie-rating').value) : null;
  const blurb = document.getElementById('movie-blurb').value;

  if (!title) {
    showToast('Title is required');
    return;
  }

  const warningEl = document.getElementById('movie-validation-warning');

  // If we have a previously validated selection, merge user edits on top
  if (validatedMovieData && !forceSaveMovie) {
    await saveMovieToDb({
      title,
      year: year ?? validatedMovieData.year,
      poster_url: posterUrl ?? validatedMovieData.poster_url,
      rating: rating ?? validatedMovieData.rating,
      blurb: blurb || validatedMovieData.blurb,
      tmdb_id: validatedMovieData.tmdb_id,
      validated: true,
    });
    return;
  }

  // If user pressed Save again after seeing the warning, force save
  if (forceSaveMovie) {
    await saveMovieToDb({
      title, year, poster_url: posterUrl, rating, blurb,
      tmdb_id: null, validated: false,
    });
    return;
  }

  // First save attempt — validate against TMDB
  if (title !== validatedMovieData?.title) {
    // Title changed since last validation — need to re-validate
    try {
      const res = await fetch(`${API_BASE}/api/movie/search?query=${encodeURIComponent(title)}`);
      if (!res.ok) throw new Error('Search failed');

      const data = await res.json();
      const match = data.results.find(m =>
        m.title.toLowerCase() === title.toLowerCase() &&
        (!year || m.year === year)
      );

      if (match) {
        // Found a match — auto-populate and save
        validatedMovieData = {
          tmdb_id: match.id,
          title: match.title,
          year: match.year,
          poster_url: match.poster_url,
          rating: match.rating,
          blurb: match.overview,
          validated: true,
        };

        await saveMovieToDb(validatedMovieData);
        return;
      }
    } catch (err) {
      console.warn('Validation search failed:', err);
    }

    // No match found — show warning
    warningEl.style.display = 'flex';
    forceSaveMovie = true;
    showToast('Press Save again to confirm');
    return;
  }

  // If nothing else, just save what's there
  await saveMovieToDb({
    title, year, poster_url: posterUrl, rating, blurb,
    tmdb_id: null, validated: false,
  });
});

async function saveMovieToDb(data) {
  try {
    const res = await fetch(`${API_BASE}/api/movie`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!res.ok) throw new Error('Save failed');

    state.movie = await res.json();
    document.getElementById('movie-validation-warning').style.display = 'none';
    validatedMovieData = null;
    forceSaveMovie = false;
    showToast('Movie saved');
  } catch (err) {
    console.error('Save movie error:', err);
    showToast('Save failed');
  }
}

// ============================================
// SERVICE WORKER
// ============================================

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(() => console.log('[SW] Registered'))
      .catch(err => console.error('[SW] Registration failed:', err));
  }
}

// ============================================
// UTILITIES
// ============================================

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============================================
// DISPLAY OVERRIDE
// ============================================

async function fetchDisplayOverride() {
  try {
    const res = await fetch(`${API_BASE}/api/display-override`);
    if (!res.ok) return;
    const data = await res.json();
    state.displayOverride = data.screen;
  } catch (err) {
    console.error('Fetch display override error:', err);
  }
}

function renderDisplayOverride() {
  const activeScreen = state.displayOverride || 'auto';

  // Set active card
  document.querySelectorAll('.display-card').forEach(card => {
    card.classList.toggle('display-card--active', card.dataset.screen === activeScreen);
  });

  // Update current text
  updateDisplayCurrentText(state.displayOverride);
}

function updateDisplayCurrentText(override) {
  const el = document.getElementById('display-current-text');
  if (!el) return;
  if (override) {
    const labels = { photo: 'Photos', weather: 'Weather', memo: 'Memo', list: 'List', movie: 'Movie Night', ha: 'Home Assistant' };
    el.textContent = `Overridden — showing ${labels[override] || override}`;
  } else {
    el.textContent = 'Following schedule';
  }
}

// ============================================
// HOME ASSISTANT
// ============================================

async function fetchHaConfig() {
  try {
    const res = await fetch(`${API_BASE}/api/ha/config`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.haConfig = await res.json();
  } catch (e) { console.error('Fetch HA config error:', e); }
}

async function fetchHaDevices() {
  try {
    const res = await fetch(`${API_BASE}/api/ha/devices`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.haDevices = await res.json();
  } catch (e) { console.error('Fetch HA devices error:', e); }
}

function renderHaConfig() {
  if (!state.haConfig) return;

  const urlInput = document.getElementById('ha-url');
  const keyInput = document.getElementById('ha-api-key');
  const statusEl = document.getElementById('ha-last-synced');

  urlInput.value = state.haConfig.url || '';
  keyInput.value = ''; // Don't populate masked key

  if (state.haConfig.last_synced) {
    statusEl.textContent = `Last synced: ${state.haConfig.last_synced}`;
  } else {
    statusEl.textContent = 'Not yet synced';
  }
}

function renderHaDevices() {
  const container = document.getElementById('ha-devices-list');
  const empty = document.getElementById('ha-empty');

  if (!state.haDevices.length) {
    container.innerHTML = '';
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';

  const typeLabels = { switch: 'Switch', light: 'Light', fan: 'Fan', lock: 'Lock', climate: 'Climate' };

  container.innerHTML = state.haDevices.map(device => `
    <div class="ha-device-card" data-id="${device.id}">
      <div class="ha-device-card__header">
        <span class="ha-device-card__name">${escapeHtml(device.name)}</span>
        <span class="ha-device-card__entity">${escapeHtml(device.entity_id)}</span>
      </div>
      <div class="ha-device-card__body">
        <span class="ha-device-card__type">${typeLabels[device.device_type] || device.device_type}</span>
        <span class="ha-device-card__status ha-device-card__status--${device.is_on ? 'on' : 'off'}">
          ${device.status || (device.is_on ? 'On' : 'Off')}
        </span>
        ${device.is_active ? '<span class="ha-device-card__badge">Dock</span>' : ''}
      </div>
      <div class="ha-device-card__actions">
        <button class="ha-device-card__action-btn" onclick="toggleDeviceFavorite(${device.id})" aria-label="Toggle dock">
          <svg class="icon icon--sm" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="${device.is_active ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button class="ha-device-card__action-btn ha-device-card__action-btn--delete" data-delete-ha-id="${device.id}" aria-label="Delete ${device.name}">
          <svg class="icon icon--sm"><use href="#icon-trash"/></svg>
        </button>
      </div>
    </div>
  `).join('');

  setupHaDeviceInteractions();
}

async function toggleDeviceFavorite(id) {
  const device = state.haDevices.find(d => d.id === id);
  if (!device) return;
  try {
    const res = await fetch(`${API_BASE}/api/ha/devices/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !device.is_active }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await fetchHaDevices();
    renderHaDevices();
  } catch (err) {
    console.error('Toggle device favorite error:', err);
    showToast('Update failed');
  }
}

// --- Scenes (hardcoded, matches dashboard) ---
const HA_SCENES = [
  { id: 'scene.good_morning', name: 'Good Morning', icon: 'sun', is_active: false },
  { id: 'scene.movie_night', name: 'Movie Night', icon: 'switch', is_active: false },
  { id: 'scene.away', name: 'Away', icon: 'lock', is_active: false },
];

function renderHaScenes() {
  const container = document.getElementById('ha-scenes-list');
  if (!container) return;

  container.innerHTML = HA_SCENES.map(scene => `
    <div class="ha-device-card">
      <div class="ha-device-card__header">
        <span class="ha-device-card__name">${escapeHtml(scene.name)}</span>
        <span class="ha-device-card__entity">${escapeHtml(scene.id)}</span>
      </div>
      <div class="ha-device-card__body">
        ${scene.is_active ? '<span class="ha-device-card__badge">Dock</span>' : ''}
      </div>
      <div class="ha-device-card__actions">
        <button class="ha-device-card__action-btn" onclick="toggleSceneActive('${scene.id}')" aria-label="Toggle dock">
          <svg class="icon icon--sm" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="${scene.is_active ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </div>
  `).join('');
}

function toggleSceneActive(id) {
  const scene = HA_SCENES.find(s => s.id === id);
  if (!scene) return;
  scene.is_active = !scene.is_active;
  renderHaScenes();
}

function setupHaDeviceInteractions() {
  // Toggle buttons
  document.querySelectorAll('[data-toggle-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.dataset.toggleId);
      try {
        const res = await fetch(`${API_BASE}/api/ha/devices/${id}/toggle`, { method: 'PUT' });
        if (!res.ok) throw new Error('Toggle failed');
        await fetchHaDevices();
        renderHaDevices();
        showToast('Device toggled');
      } catch (err) {
        console.error('Toggle error:', err);
        showToast('Toggle failed');
      }
    });
  });

  // Delete buttons
  document.querySelectorAll('[data-delete-ha-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      deletingHaDeviceId = parseInt(btn.dataset.deleteHaId);
      const device = state.haDevices.find(d => d.id === deletingHaDeviceId);
      const nameEl = document.getElementById('ha-delete-device-name');
      if (device && nameEl) nameEl.textContent = `"${device.name}" will be removed.`;
      showModal('modal-ha-delete');
    });
  });
}

// Save HA config
async function saveHaConfig() {
  const url = document.getElementById('ha-url').value.trim();
  const apiKey = document.getElementById('ha-api-key').value.trim();

  if (!url) {
    showToast('URL is required');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/ha/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, api_key: apiKey }),
    });
    if (!res.ok) throw new Error(await res.text());
    await fetchHaConfig();
    renderHaConfig();
    showToast('Connection saved');
  } catch (err) {
    console.error('Save HA config error:', err);
    showToast('Save failed');
  }
}

// Sync HA devices
async function syncHaDevices() {
  try {
    const res = await fetch(`${API_BASE}/api/ha/sync`, { method: 'POST' });
    if (!res.ok) throw new Error(await res.text());
    state.haDevices = await res.json();
    await fetchHaConfig();
    renderHaDevices();
    renderHaConfig();
    showToast(`Synced ${state.haDevices.length} devices`);
  } catch (err) {
    console.error('Sync error:', err);
    showToast('Sync failed — check connection settings');
  }
}

// Add HA device
async function addHaDevice() {
  const entityId = document.getElementById('ha-entity-id').value.trim();
  const name = document.getElementById('ha-device-name').value.trim();
  const deviceType = document.getElementById('ha-device-type').value;

  if (!entityId || !name) {
    showToast('Entity ID and name are required');
    return;
  }

  // Determine icon based on type
  const iconMap = { switch: 'switch', light: 'light', fan: 'fan', lock: 'lock', climate: 'climate' };

  try {
    const res = await fetch(`${API_BASE}/api/ha/devices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entity_id: entityId,
        name,
        device_type: deviceType,
        icon: iconMap[deviceType] || 'switch',
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    await fetchHaDevices();
    renderHaDevices();
    showToast(`Added "${name}"`);

    // Clear inputs
    document.getElementById('ha-entity-id').value = '';
    document.getElementById('ha-device-name').value = '';
  } catch (err) {
    console.error('Add device error:', err);
    showToast(err.message.includes('already exists') ? 'Entity already added' : 'Failed to add device');
  }
}

// Discover entities from HA
async function discoverHaEntities() {
  const resultsContainer = document.getElementById('ha-discover-results');

  try {
    const res = await fetch(`${API_BASE}/api/ha/entities`);
    if (!res.ok) throw new Error(await res.text());

    const entities = await res.json();

    if (!entities.length) {
      resultsContainer.innerHTML = '<div class="ha-discover-empty">No entities found</div>';
      resultsContainer.style.display = 'block';
      return;
    }

    // Filter to useful domains only
    const usefulDomains = ['light', 'switch', 'fan', 'lock', 'climate'];
    const filtered = entities.filter(e => usefulDomains.includes(e.domain));

    resultsContainer.innerHTML = filtered.map(entity => `
      <div class="ha-discover-item" data-entity-id="${escapeHtml(entity.entity_id)}">
        <span class="ha-discover-item__id">${escapeHtml(entity.entity_id)}</span>
        <span class="ha-discover-item__domain">${entity.domain}</span>
        <span class="ha-discover-item__state ha-discover-item__state--${entity.registered ? 'registered' : 'available'}">
          ${entity.registered ? '✓ Added' : entity.state}
        </span>
        ${!entity.registered ? `<button class="btn btn--add ha-discover-add-btn" data-entity-id="${escapeHtml(entity.entity_id)}">Add</button>` : ''}
      </div>
    `).join('');

    resultsContainer.style.display = 'block';

    // Wire up add buttons
    resultsContainer.querySelectorAll('.ha-discover-add-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const entityId = btn.dataset.entityId;
        const domain = entityId.split('.')[0];
        const friendlyName = entityId.split('.')[1].replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

        try {
          const res = await fetch(`${API_BASE}/api/ha/devices`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              entity_id: entityId,
              name: friendlyName,
              device_type: domain,
              icon: domain === 'climate' ? 'climate' : domain,
            }),
          });
          if (!res.ok) throw new Error(await res.text());
          await fetchHaDevices();
          renderHaDevices();
          showToast(`Added "${friendlyName}"`);
          // Refresh discovery list
          await discoverHaEntities();
        } catch (err) {
          console.error('Discover add error:', err);
          showToast('Failed to add device');
        }
      });
    });

  } catch (err) {
    console.error('Discover error:', err);
    showToast(err.message.includes('configured') ? 'Configure connection first' : 'Discovery failed');
  }
}

async function confirmDeleteHaDevice() {
  hideModal('modal-ha-delete');
  if (deletingHaDeviceId == null) return;

  try {
    const res = await fetch(`${API_BASE}/api/ha/devices/${deletingHaDeviceId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete failed');

    state.haDevices = state.haDevices.filter(d => d.id !== deletingHaDeviceId);
    renderHaDevices();
    showToast('Device removed');
  } catch (err) {
    console.error('Delete error:', err);
    showToast('Delete failed');
  } finally {
    deletingHaDeviceId = null;
  }
}

setupModals();
document.addEventListener('DOMContentLoaded', init);
