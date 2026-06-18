"""
Skylight Home - Backend API
FastAPI server with SQLite storage for dashboard content management.
"""

import asyncio
import os
import uuid
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from httpx import AsyncClient

from pydantic import BaseModel

from database import DB_DIR, get_db, init_db
from homeassistant import router as ha_router, inject_broadcast, periodic_ha_sync

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = FastAPI(title="Skylight Home", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PORT = int(os.getenv("PORT", "8894"))
TMDB_API_KEY = os.getenv("TMDB_API_KEY", "")

PHOTOS_DIR = Path(DB_DIR) / "photos"
PHOTOS_DIR.mkdir(parents=True, exist_ok=True)

POSTERS_DIR = Path(DB_DIR) / "posters"
POSTERS_DIR.mkdir(parents=True, exist_ok=True)

STATIC_DIR = Path(__file__).parent / "static"
DASHBOARD_DIR = Path(__file__).parent / "dashboard"

# --- SSE broadcast ---
sse_subscribers: list[asyncio.Queue] = []

async def broadcast_sse(event_type: str):
    """Push an event to all connected SSE clients."""
    dead = []
    for q in sse_subscribers:
        try:
            q.put_nowait(event_type)
        except asyncio.QueueFull:
            dead.append(q)
    for q in dead:
        sse_subscribers.remove(q)

# Serve Skylight dashboard at /
def _serve_dashboard(filename: str) -> FileResponse:
    return FileResponse(DASHBOARD_DIR / filename)

@app.get("/")
async def serve_dashboard_index():
    return _serve_dashboard("index.html")

@app.get("/style.css")
async def serve_dashboard_css():
    return _serve_dashboard("style.css")

@app.get("/app.js")
async def serve_dashboard_js():
    return _serve_dashboard("app.js")

@app.get("/photoframe_images/{path:path}")
async def serve_photo_image(path: str):
    return _serve_dashboard(f"photoframe_images/{path}")

@app.get("/scratchpics/{path:path}")
async def serve_scratch_pic(path: str):
    return _serve_dashboard(f"scratchpics/{path}")

@app.get("/weather-icons/{path:path}")
async def serve_weather_icon(path: str):
    return _serve_dashboard(f"weather-icons/{path}")

@app.get("/device-icons/{filename:path}")
async def serve_device_icon(filename: str):
    return _serve_dashboard(f"device-icons/{filename}")

# Serve admin PWA at /admin
if STATIC_DIR.exists():
    app.mount("/admin", StaticFiles(directory=str(STATIC_DIR), html=True), name="admin")

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class PhotoUpdate(BaseModel):
    sort_order: Optional[int] = None

class ReorderRequest(BaseModel):
    order: list[int]

class MemoData(BaseModel):
    title: str
    content: str

class ListItemCreate(BaseModel):
    text: str
    completed: bool = False
    sort_order: Optional[int] = None

class ListItemUpdate(BaseModel):
    text: Optional[str] = None
    completed: Optional[bool] = None

class MovieData(BaseModel):
    title: str
    year: Optional[int] = None
    poster_url: Optional[str] = None
    rating: Optional[float] = None
    blurb: str = ""
    tmdb_id: Optional[int] = None
    validated: bool = False

class DisplayOverride(BaseModel):
    screen: Optional[str] = None  # "photo", "weather", "movie", "memo", "list", or null for auto

# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------

@app.on_event("startup")
async def startup():
    init_db()
    # Inject SSE broadcast into HA module so its routes can emit events
    inject_broadcast(broadcast_sse)
    # Start periodic HA sync (every 30s)
    asyncio.create_task(periodic_ha_sync(broadcast_sse))

# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/poster/{filename:path}")
async def serve_poster(filename: str):
    poster_path = POSTERS_DIR / filename
    if not poster_path.is_file():
        raise HTTPException(status_code=404, detail="Poster not found")
    return FileResponse(poster_path)

@app.get("/api/health")
async def health_check():
    return {"status": "ok"}

@app.get("/api/events")
async def sse_endpoint():
    """Server-Sent Events stream. Dashboard connects here for real-time updates."""
    queue: asyncio.Queue = asyncio.Queue(maxsize=16)
    sse_subscribers.append(queue)

    async def event_generator():
        # Send initial connection event
        yield "data: connected\n\n"
        try:
            while True:
                event_type = await queue.get()
                yield f"event: update\ndata: {event_type}\n\n"
        finally:
            try:
                sse_subscribers.remove(queue)
            except ValueError:
                pass

    from fastapi.responses import StreamingResponse
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

# ---------------------------------------------------------------------------
# Photos
# ---------------------------------------------------------------------------

@app.get("/photos/{filename:path}")
async def serve_photo(filename: str):
    photo_path = PHOTOS_DIR / filename
    if not photo_path.is_file():
        raise HTTPException(status_code=404, detail="Photo not found")
    return FileResponse(photo_path)

@app.post("/api/photos/upload", status_code=201)
async def upload_photo(file: UploadFile = File(...)):
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are allowed")

    ext = Path(file.filename).suffix or ".jpg"
    unique_name = f"{uuid.uuid4().hex}{ext}"
    dest_path = PHOTOS_DIR / unique_name

    contents = await file.read()
    if len(contents) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 10MB)")

    dest_path.write_bytes(contents)

    db = get_db()
    try:
        cursor = db.execute(
            "INSERT INTO photos (filename, original_name, mime_type, size_bytes, sort_order) VALUES (?, ?, ?, ?, ?)",
            (unique_name, file.filename, file.content_type, len(contents), 0),
        )
        db.commit()
        asyncio.create_task(broadcast_sse('photos'))
        row = db.execute("SELECT * FROM photos WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return dict(row)
    except Exception as e:
        dest_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()

@app.get("/api/photos")
async def list_photos():
    db = get_db()
    try:
        rows = db.execute("SELECT * FROM photos ORDER BY sort_order ASC").fetchall()
        return [dict(r) for r in rows]
    finally:
        db.close()

# NOTE: /reorder must come BEFORE /{photo_id} or FastAPI treats "reorder" as a photo_id
@app.put("/api/photos/reorder")
async def reorder_photos(data: ReorderRequest):
    db = get_db()
    try:
        for index, photo_id in enumerate(data.order):
            db.execute("UPDATE photos SET sort_order = ? WHERE id = ?", (index, photo_id))
        db.commit()
        asyncio.create_task(broadcast_sse('photos'))
        rows = db.execute("SELECT * FROM photos ORDER BY sort_order ASC").fetchall()
        return [dict(r) for r in rows]
    finally:
        db.close()

@app.put("/api/photos/{photo_id}")
async def update_photo(photo_id: int, data: PhotoUpdate):
    db = get_db()
    try:
        db.execute("UPDATE photos SET sort_order = ? WHERE id = ?", (data.sort_order, photo_id))
        db.commit()
        row = db.execute("SELECT * FROM photos WHERE id = ?", (photo_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Photo not found")
        return dict(row)
    finally:
        db.close()

@app.delete("/api/photos/{photo_id}")
async def delete_photo(photo_id: int):
    db = get_db()
    try:
        row = db.execute("SELECT * FROM photos WHERE id = ?", (photo_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Photo not found")
        filename = row["filename"]
        db.execute("DELETE FROM photos WHERE id = ?", (photo_id,))
        db.commit()
        asyncio.create_task(broadcast_sse('photos'))
        (PHOTOS_DIR / filename).unlink(missing_ok=True)
        return {"deleted": photo_id}
    finally:
        db.close()

# ---------------------------------------------------------------------------
# Memo
# ---------------------------------------------------------------------------

@app.get("/api/memo")
async def get_memo():
    db = get_db()
    try:
        row = db.execute("SELECT * FROM memo WHERE id = 1").fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Memo not found")
        return dict(row)
    finally:
        db.close()

@app.put("/api/memo")
async def update_memo(data: MemoData):
    db = get_db()
    try:
        db.execute(
            "UPDATE memo SET title = ?, content = ?, updated_at = datetime('now') WHERE id = 1",
            (data.title, data.content),
        )
        db.commit()
        asyncio.create_task(broadcast_sse('memo'))
        row = db.execute("SELECT * FROM memo WHERE id = 1").fetchone()
        return dict(row)
    finally:
        db.close()

# ---------------------------------------------------------------------------
# List Items
# ---------------------------------------------------------------------------

@app.post("/api/list-items", status_code=201)
async def create_list_item(item: ListItemCreate):
    db = get_db()
    try:
        cursor = db.execute(
            "INSERT INTO list_items (text, completed, sort_order) VALUES (?, ?, ?)",
            (item.text, 1 if item.completed else 0, item.sort_order or 0),
        )
        db.commit()
        asyncio.create_task(broadcast_sse('list-items'))
        row = db.execute("SELECT * FROM list_items WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return dict(row)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()

@app.get("/api/list-items")
async def list_items():
    db = get_db()
    try:
        rows = db.execute("SELECT * FROM list_items ORDER BY sort_order ASC").fetchall()
        return [dict(r) for r in rows]
    finally:
        db.close()

@app.get("/api/list-items/{item_id}")
async def get_list_item(item_id: int):
    db = get_db()
    try:
        row = db.execute("SELECT * FROM list_items WHERE id = ?", (item_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Item not found")
        return dict(row)
    finally:
        db.close()

@app.put("/api/list-items/{item_id}")
async def update_list_item(item_id: int, data: ListItemUpdate):
    db = get_db()
    try:
        updates, params = [], []
        if data.text is not None:
            updates.append("text = ?"); params.append(data.text)
        if data.completed is not None:
            updates.append("completed = ?"); params.append(1 if data.completed else 0)
        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")
        params.append(item_id)
        db.execute(f"UPDATE list_items SET {', '.join(updates)} WHERE id = ?", params)
        db.commit()
        asyncio.create_task(broadcast_sse('list-items'))
        row = db.execute("SELECT * FROM list_items WHERE id = ?", (item_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Item not found")
        return dict(row)
    finally:
        db.close()

@app.delete("/api/list-items/{item_id}")
async def delete_list_item(item_id: int):
    db = get_db()
    try:
        db.execute("DELETE FROM list_items WHERE id = ?", (item_id,))
        db.commit()
        asyncio.create_task(broadcast_sse('list-items'))
        return {"deleted": item_id}
    finally:
        db.close()

@app.put("/api/list-items/reorder")
async def reorder_list_items(data: ReorderRequest):
    db = get_db()
    try:
        for index, item_id in enumerate(data.order):
            db.execute("UPDATE list_items SET sort_order = ? WHERE id = ?", (index, item_id))
        db.commit()
        asyncio.create_task(broadcast_sse('list-items'))
        rows = db.execute("SELECT * FROM list_items ORDER BY sort_order ASC").fetchall()
        return [dict(r) for r in rows]
    finally:
        db.close()

# ---------------------------------------------------------------------------
# Movie
# ---------------------------------------------------------------------------

@app.get("/api/movie")
async def get_movie():
    db = get_db()
    try:
        row = db.execute("SELECT * FROM movie WHERE id = 1").fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Movie not found")
        result = dict(row)
        result["validated"] = bool(result["validated"])
        # Convert local filename to serveable URL (skip if already a full URL from legacy data)
        if result["poster_url"] and not result["poster_url"].startswith("http"):
            result["poster_url"] = f"/poster/{result['poster_url']}"
        return result
    finally:
        db.close()

async def _download_poster(url: str) -> Optional[str]:
    """Download a poster image from a URL and save it locally. Returns local filename or None."""
    if not url:
        return None
    try:
        async with AsyncClient(timeout=15) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                return None
        # Determine extension from content type or default to jpg
        ct = resp.headers.get("content-type", "image/jpeg")
        ext = ".png" if "png" in ct else ".jpg"
        filename = f"{uuid.uuid4().hex}{ext}"
        dest = POSTERS_DIR / filename
        dest.write_bytes(resp.content)
        return filename
    except Exception as e:
        print(f"Poster download failed: {e}")
        return None

@app.put("/api/movie")
async def update_movie(data: MovieData):
    db = get_db()
    try:
        # Get current poster filename to clean up later
        current = db.execute("SELECT poster_url FROM movie WHERE id = 1").fetchone()
        current_filename = current["poster_url"] if current else None

        # Resolve poster: keep local /poster/ refs, download remote URLs
        local_filename = None
        if data.poster_url:
            if data.poster_url.startswith('/poster/'):
                local_filename = data.poster_url[len('/poster/'):]
            else:
                local_filename = await _download_poster(data.poster_url)

        # Delete old poster file if it changed
        if current_filename and current_filename != local_filename:
            old_path = POSTERS_DIR / current_filename
            old_path.unlink(missing_ok=True)

        # Store local filename (not remote URL) in DB
        db.execute(
            """UPDATE movie SET title = ?, year = ?, poster_url = ?, rating = ?,
               blurb = ?, tmdb_id = ?, validated = ?, updated_at = datetime('now')
               WHERE id = 1""",
            (data.title, data.year, local_filename, data.rating, data.blurb, data.tmdb_id, 1 if data.validated else 0),
        )
        db.commit()
        asyncio.create_task(broadcast_sse('movie'))
        row = db.execute("SELECT * FROM movie WHERE id = 1").fetchone()
        result = dict(row)
        result["validated"] = bool(result["validated"])
        # Convert local filename back to a serveable URL for the frontend
        if result["poster_url"] and not result["poster_url"].startswith("http"):
            result["poster_url"] = f"/poster/{result['poster_url']}"
        return result
    finally:
        db.close()

@app.get("/api/movie/search")
async def search_movie(query: str = Query(..., min_length=1)):
    if not TMDB_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="TMDB_API_KEY not configured.",
        )
    async with AsyncClient(timeout=10) as client:
        response = await client.get(
            "https://api.themoviedb.org/3/search/movie",
            params={"api_key": TMDB_API_KEY, "query": query, "language": "en-US"},
        )
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail=f"TMDB API error: {response.status_code}")

    results = []
    for m in response.json().get("results", [])[:10]:
        pp = m.get("poster_path")
        results.append({
            "id": m["id"],
            "title": m["title"],
            "year": m.get("release_date", "")[:4] if m.get("release_date") else None,
            "poster_url": f"https://image.tmdb.org/t/p/w500{pp}" if pp else None,
            "rating": m.get("vote_average"),
            "overview": m.get("overview", ""),
        })
    return {"results": results}

# ---------------------------------------------------------------------------
# Display Override
# ---------------------------------------------------------------------------

VALID_SCREENS = {'photo', 'weather', 'movie', 'memo', 'list', 'ha'}

@app.get("/api/display-override")
async def get_display_override():
    db = get_db()
    try:
        row = db.execute("SELECT value FROM settings WHERE key = ?", ('display_override',)).fetchone()
        value = row['value'] if row else None
        return {"screen": value if value in VALID_SCREENS else None}
    finally:
        db.close()

@app.put("/api/display-override")
async def set_display_override(data: DisplayOverride):
    if data.screen is not None and data.screen not in VALID_SCREENS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid screen. Must be one of: {', '.join(sorted(VALID_SCREENS))}, or null",
        )
    db = get_db()
    try:
        db.execute(
            "UPDATE settings SET value = ? WHERE key = 'display_override'",
            (data.screen,),
        )
        db.commit()
        asyncio.create_task(broadcast_sse('display-override'))
        return {"screen": data.screen}
    finally:
        db.close()

# ---------------------------------------------------------------------------
# Home Assistant routes (extracted module)
# ---------------------------------------------------------------------------
app.include_router(ha_router)
