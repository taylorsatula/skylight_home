# Skylight Home — AI Assistant Guide

A schedule-driven **calm-screen** dashboard running on a Raspberry Pi, with a phone
**admin PWA** for managing content. The screen shows one thing at a time, picked by a
time-based schedule, with content stored in SQLite and pushed to the display via SSE.

## Deployment

- **Backend:** FastAPI/Uvicorn on port **8894**, run as the systemd service
  `skylight-backend` (unit: `backend/skylight-backend.service`).
- **Service user:** `server_admin` · **Working dir:** `/home/server_admin/backend`
- **Env:** `PORT=8894`, `TMDB_API_KEY` (movie search only).
- **Setup:** `bash backend/setup.sh` (venv + deps + systemd install), then
  `sudo systemctl start skylight-backend`.
- The dashboard frontend files live in `backend/dashboard/` and are served directly
  by the backend.

## Architecture

**Two frontends + one API, single origin (port 8894):**

1. **Dashboard** (`backend/dashboard/app.js`, served at `/`) — the calm screen. Single-file
   vanilla JS. No framework, no config file, no build step. `CONFIG` (dock devices) and
   `SCHEDULE` are hardcoded constants in `app.js`.
2. **Admin PWA** (`backend/static/`, served at `/admin`) — phone UI to manage photos,
   memo, list, movie, and display override. Vanilla JS PWA with service worker.
3. **Backend API** (`backend/main.py`) — FastAPI + SQLite (`backend/database.py`),
   REST endpoints + an SSE stream (`/api/events`) that broadcasts on every mutation so
   the dashboard updates in real time.

**Schedule model** (`backend/dashboard/app.js` `SCHEDULE`): an ordered array of rules
`{ type, days?, start, end }`. Evaluated top-to-bottom each minute, first match wins,
default is the photo frame. A manual admin `display_override` takes precedence and is
auto-cleared when the schedule crosses into a new 30-min slot.

**Render model:** exactly one "interrupt" is shown at a time. `renderScreen(type)`
switches between `showPhoto`, `showWeather`, `showMovie`, `showMemo`, `showList`,
`showTrashNight`, `showError`. The dismiss button + swipe (photos) navigate.

**Photo frame:** rotates through `/api/photos` every 120s with a sliding transition and
a countdown bar; swipe left/right to navigate manually.

**Data flow:** dashboard fetches all content at startup via `fetchDashboardData()`
(photos, movie, memo, list-items, display-override) + `fetchWeather()` (Open-Meteo),
then maintains a persistent `EventSource('/api/events')` for incremental updates, plus a
30s polling fallback.

## File map

```
backend/main.py                               # FastAPI app — API + SSE + serves / and /admin
backend/database.py                    # SQLite schema, seed data, get_db()/init_db()
backend/requirements.txt               # fastapi, uvicorn, httpx, python-multipart
backend/setup.sh                       # Pi setup (venv, deps, systemd unit)
backend/skylight-backend.service       # systemd unit (server_admin, port 8894)
backend/data/                          # Runtime DB + photos + posters (gitignored)
backend/dashboard/{app.js,index.html,style.css}  # Dashboard (source of truth)
backend/dashboard/{photoframe_images,scratchpics,weather-icons}/  # Static image assets
backend/static/{app.js,index.html,style.css,sw.js,manifest.json}  # Admin PWA
backend/static/icons/                  # PWA icons
```

## Backend reference (`backend/main.py`)

REST endpoints (all mutating ones call `broadcast_sse(type)`):
- Photos: `GET/POST /api/photos`, `POST /api/photos/upload` (≤10MB),
  `PUT /api/photos/{id}`, `DELETE /api/photos/{id}`, `PUT /api/photos/reorder`
  (⚠ `/reorder` must stay defined before `/{photo_id}`).
- Memo (singleton id=1): `GET/PUT /api/memo`.
- List items: `POST/GET /api/list-items`, `GET/PUT/DELETE /api/list-items/{id}`,
  `PUT /api/list-items/reorder`.
- Movie (singleton id=1): `GET/PUT /api/movie`, `GET /api/movie/search?query=`.
  Remote poster URLs are downloaded into `POSTERS_DIR` and stored as local filenames;
  `/poster/{filename}` serves them.
- Display override: `GET/PUT /api/display-override` (valid screens:
  `photo|weather|movie|memo|list`, or `null` for auto). Stored in `settings`.
- Real-time: `GET /api/events` (SSE), `GET /api/health`.
- Static: `/`, `/admin` (mounted), `/photos/{file}`, `/poster/{file}`,
  `/photoframe_images/*`, `/scratchpics/*`, `/weather-icons/*`.

**Database** (`backend/database.py`): SQLite at `backend/data/skylight.db`, WAL mode,
row factory. Tables: `photos`, `memo`, `list_items`, `movie`, `settings`.
`init_db()` is idempotent (CREATE IF NOT EXISTS + INSERT OR IGNORE seed rows).

## Dashboard coding guide (`backend/dashboard/app.js`)

Structure (top-to-bottom): `CONFIG` → `SCHEDULE` → schedule/screen selection →
data fetch → weather (Open-Meteo WMO codes + icon map) → interrupt system →
per-screen render functions (`showPhoto/showWeather/showMovie/showMemo/showList/
showTrashNight/showError`) → clock → SVG `ICONS` → dock → photo swipe/transition →
SSE + init.

**To add a new screen:**
1. Add a render function `showX()` that fills `#interrupt-content` and sets
   `currentInterrupt = { type: 'x' }`.
2. Add a `case` in `renderScreen(type)`.
3. Add a schedule rule (and/or make it selectable as an admin override — see
   `VALID_SCREENS` in `main.py` and `displayOverride` handling in `app.js`).
4. If it has backend data, add a fetch in `fetchDashboardData()` + an `update` case in
   `handleSSEUpdate()` + a broadcast in the backend endpoint.

**Conventions:**
- Weather is keyed off Open-Meteo **WMO weather codes** → icon files in
  `backend/dashboard/weather-icons/`. See `WMO_CODES` / `WEATHER_ICONS` /
  `WEATHER_ICONS_NIGHT`.
- The dock tiles in `renderDock()` are display-only (no toggle handlers wired up).
- Touch: use `pointer-events: none` on children to avoid event bubbling; include
  `-webkit-tap-highlight-color: transparent`. Swipe gestures live in
  `initPhotoSwipeListeners()`.

## Admin PWA guide (`backend/static/app.js`)

Five views switched by `.tab`/`.view--active`: Gallery, Memo, List, Movie, Display.
`API_BASE = ''` (same origin). Modals are plain show/hide on `display: flex`.
Gallery supports both HTML5 drag-drop and a custom touch long-press drag (`setupTouchDrag`).
Movie save validates against TMDB and requires a second Save press to override.

## CSS guide

**Two separate stylesheets** with different variable vocabularies — don't mix them:

### Dashboard `style.css`
- Backgrounds: `--bg-calm`, `--surface-dock`, `--surface-dock-hover`, `--surface-tile`,
  `--surface-tile-active`, `--icon-bg-off`, `--icon-bg-on`, `--icon-color-off`,
  `--icon-color-on`
- Text: `--text-primary`, `--text-secondary`, `--text-muted`, `--text-dark`,
  `--text-dark-secondary`
- Semantic: `--color-accent` `--color-success` `--color-warning` `--color-alert`
  `--color-error`
- Spacing: `--spacing-xs/sm/md/lg/xl/2xl` (4/8/12/16/20/24)
- Radius: `--radius-sm/md/lg/xl/full` (8/12/16/18/9999)
- Font: `--font-family` (system)

### Admin PWA `backend/static/style.css`
- Surfaces: `--surface-bg`, `--surface-widget`, `--surface-glass`, `--surface-inset`,
  `--surface-hover`
- Same `--text-*` and `--color-*` as the dashboard
- Spacing uses `--space-*` (not `--spacing-*`): `--space-xs/sm/md/lg/xl/2xl`
- Radius: `--radius-sm/md/lg/xl`; plus `--tab-bar-height`, `--safe-top`, `--safe-bottom`

**Rules:**
- Use CSS variables, don't hardcode colors/sizes.
- Don't create new CSS files — extend the relevant stylesheet.
- Don't create separate JS modules — extend the existing single-file `app.js`.
- Don't use `!important`.
- Don't inline styles except for dynamic values (transforms, offsets, widths).

## Code hygiene

Clean up dead code while you're in there. Don't leave it till later — you'll forget and
then we'll have technical debt.

## Planning & revisions

When revising an implementation plan based on feedback or changed requirements, include
a **"What changed:"** summary with checkboxes showing what was added/removed/kept.

```
**What changed:**
- ❌ Removed settings UI modal (no HTML changes needed)
- ✅ Kept backend display control via display_override
```
