"""
Skylight Home - Backend API
FastAPI server with SQLite storage for dashboard content management.
"""

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

STATIC_DIR = Path(__file__).parent / "static"
DASHBOARD_DIR = Path(__file__).parent / "dashboard"

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

# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------

@app.on_event("startup")
async def startup():
    init_db()

# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health_check():
    return {"status": "ok"}

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
        (PHOTOS_DIR / filename).unlink(missing_ok=True)
        return {"deleted": photo_id}
    finally:
        db.close()

@app.put("/api/photos/reorder")
async def reorder_photos(data: ReorderRequest):
    db = get_db()
    try:
        for index, photo_id in enumerate(data.order):
            db.execute("UPDATE photos SET sort_order = ? WHERE id = ?", (index, photo_id))
        db.commit()
        rows = db.execute("SELECT * FROM photos ORDER BY sort_order ASC").fetchall()
        return [dict(r) for r in rows]
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
        return result
    finally:
        db.close()

@app.put("/api/movie")
async def update_movie(data: MovieData):
    db = get_db()
    try:
        db.execute(
            """UPDATE movie SET title = ?, year = ?, poster_url = ?, rating = ?,
               blurb = ?, tmdb_id = ?, validated = ?, updated_at = datetime('now')
               WHERE id = 1""",
            (data.title, data.year, data.poster_url, data.rating, data.blurb, data.tmdb_id, 1 if data.validated else 0),
        )
        db.commit()
        row = db.execute("SELECT * FROM movie WHERE id = 1").fetchone()
        result = dict(row)
        result["validated"] = bool(result["validated"])
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
