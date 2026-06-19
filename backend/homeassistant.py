"""
Skylight Home - Home Assistant Integration Module
Handles HA REST API communication, device CRUD, sync, and control.
Mounted as /api/ha/* routes via APIRouter.
"""

import asyncio
from typing import Optional

from fastapi import APIRouter, HTTPException
from httpx import AsyncClient
from pydantic import BaseModel

import sqlite3

from database import get_db

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class HaConfigData(BaseModel):
    url: str
    api_key: str

class HaDeviceCreate(BaseModel):
    entity_id: str
    name: str
    device_type: str = 'switch'
    icon: str = 'switch'
    is_favorite: bool = False
    sort_order: Optional[int] = None

class HaDeviceUpdate(BaseModel):
    name: Optional[str] = None
    device_type: Optional[str] = None
    icon: Optional[str] = None
    is_favorite: Optional[bool] = None
    sort_order: Optional[int] = None

class ReorderRequest(BaseModel):
    order: list[int]

class HaSceneCreate(BaseModel):
    entity_id: str
    name: str
    icon: str = 'scene'
    is_favorite: bool = False
    sort_order: Optional[int] = None

class HaSceneUpdate(BaseModel):
    name: Optional[str] = None
    icon: Optional[str] = None
    is_favorite: Optional[bool] = None
    sort_order: Optional[int] = None

# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter(prefix="/api/ha")

# broadcast_sse is injected at runtime by main.py
_broadcast_sse = None

def inject_broadcast(broadcast_fn):
    """Inject the SSE broadcast function from main.py."""
    global _broadcast_sse
    _broadcast_sse = broadcast_fn

async def _emit(event_type: str):
    if _broadcast_sse:
        await _broadcast_sse(event_type)

# ---------------------------------------------------------------------------
# HA API client
# ---------------------------------------------------------------------------

async def _ha_get_state(entity_id: str, base_url: str, api_key: str) -> Optional[str]:
    """Fetch the current state of a single entity from HA."""
    try:
        async with AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{base_url}/api/states/{entity_id}",
                headers={"Authorization": f"Bearer {api_key}"},
            )
        if resp.status_code == 200:
            return resp.json().get("state")
    except Exception as e:
        print(f"HA state fetch failed for {entity_id}: {e}")
    return None

async def _ha_call_service(service_domain: str, service_name: str, entity_id: str, base_url: str, api_key: str, **kwargs):
    """Call an HA service (e.g., light.turn_on)."""
    payload = {"entity_id": entity_id}
    payload.update(kwargs)
    try:
        async with AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{base_url}/api/services/{service_domain}/{service_name}",
                json=payload,
                headers={"Authorization": f"Bearer {api_key}"},
            )
        return resp.status_code == 200
    except Exception as e:
        print(f"HA service call failed ({service_domain}.{service_name} on {entity_id}): {e}")
        return False

async def _ha_fetch_all_states(base_url: str, api_key: str) -> dict:
    """Fetch all states from HA. Returns {entity_id: state}."""
    try:
        async with AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{base_url}/api/states",
                headers={"Authorization": f"Bearer {api_key}"},
            )
        if resp.status_code == 200:
            states = {}
            for item in resp.json():
                states[item["entity_id"]] = item["state"]
            return states
    except Exception as e:
        print(f"HA bulk state fetch failed: {e}")
    return {}

# ---------------------------------------------------------------------------
# Routes — Config
# ---------------------------------------------------------------------------

@router.get("/config")
async def get_ha_config():
    db = get_db()
    try:
        row = db.execute("SELECT * FROM ha_config WHERE id = 1").fetchone()
        if not row:
            return {"url": "", "api_key": "", "last_synced": None}
        result = dict(row)
        # Mask the API key — show only last 4 chars
        key = result.get("api_key", "")
        result["api_key"] = f'****{key[-4:]}' if len(key) > 4 else ""
        return result
    finally:
        db.close()

@router.put("/config")
async def update_ha_config(data: HaConfigData):
    db = get_db()
    try:
        db.execute(
            "UPDATE ha_config SET url = ?, api_key = ? WHERE id = 1",
            (data.url, data.api_key),
        )
        db.commit()
        return {"status": "saved"}
    finally:
        db.close()

# ---------------------------------------------------------------------------
# Routes — Devices CRUD
# ---------------------------------------------------------------------------

@router.get("/devices")
async def list_ha_devices():
    db = get_db()
    try:
        rows = db.execute("SELECT * FROM ha_devices ORDER BY sort_order ASC").fetchall()
        return [dict(r) for r in rows]
    finally:
        db.close()

@router.post("/devices", status_code=201)
async def create_ha_device(data: HaDeviceCreate):
    db = get_db()
    try:
        cursor = db.execute(
            "INSERT INTO ha_devices (entity_id, name, device_type, icon, is_favorite, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
            (data.entity_id, data.name, data.device_type, data.icon, 1 if data.is_favorite else 0, data.sort_order or 0),
        )
        db.commit()
        asyncio.create_task(_emit('ha-devices'))
        row = db.execute("SELECT * FROM ha_devices WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return dict(row)
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="Entity ID already exists")
    finally:
        db.close()

@router.put("/devices/{device_id}")
async def update_ha_device(device_id: int, data: HaDeviceUpdate):
    db = get_db()
    try:
        updates, params = [], []
        if data.name is not None:
            updates.append("name = ?"); params.append(data.name)
        if data.device_type is not None:
            updates.append("device_type = ?"); params.append(data.device_type)
        if data.icon is not None:
            updates.append("icon = ?"); params.append(data.icon)
        if data.is_favorite is not None:
            updates.append("is_favorite = ?"); params.append(1 if data.is_favorite else 0)
        if data.sort_order is not None:
            updates.append("sort_order = ?"); params.append(data.sort_order)
        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")
        params.append(device_id)
        db.execute(f"UPDATE ha_devices SET {', '.join(updates)} WHERE id = ?", params)
        db.commit()
        asyncio.create_task(_emit('ha-devices'))
        row = db.execute("SELECT * FROM ha_devices WHERE id = ?", (device_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Device not found")
        return dict(row)
    finally:
        db.close()

@router.delete("/devices/{device_id}")
async def delete_ha_device(device_id: int):
    db = get_db()
    try:
        db.execute("DELETE FROM ha_devices WHERE id = ?", (device_id,))
        db.commit()
        asyncio.create_task(_emit('ha-devices'))
        return {"deleted": device_id}
    finally:
        db.close()

# NOTE: /reorder must come BEFORE /{device_id}/toggle or FastAPI treats "reorder" as a device_id
@router.put("/devices/reorder")
async def reorder_ha_devices(data: ReorderRequest):
    db = get_db()
    try:
        for index, did in enumerate(data.order):
            db.execute("UPDATE ha_devices SET sort_order = ? WHERE id = ?", (index, did))
        db.commit()
        asyncio.create_task(_emit('ha-devices'))
        rows = db.execute("SELECT * FROM ha_devices ORDER BY sort_order ASC").fetchall()
        return [dict(r) for r in rows]
    finally:
        db.close()

# ---------------------------------------------------------------------------
# Routes — Sync & Control
# ---------------------------------------------------------------------------

@router.post("/sync")
async def sync_ha_devices():
    """Sync all registered devices with their actual HA state."""
    db = get_db()
    try:
        config = db.execute("SELECT url, api_key FROM ha_config WHERE id = 1").fetchone()
        if not config or not config["url"] or not config["api_key"]:
            raise HTTPException(status_code=400, detail="HA connection not configured")

        base_url = config["url"].rstrip('/')
        api_key = config["api_key"]

        # Fetch all states at once
        all_states = await _ha_fetch_all_states(base_url, api_key)
        if not all_states:
            raise HTTPException(status_code=502, detail="Failed to reach Home Assistant")

        # Update local device states
        devices = db.execute("SELECT id, entity_id FROM ha_devices").fetchall()
        for dev in devices:
            state = all_states.get(dev["entity_id"])
            if state is not None:
                is_on = 1 if state in ('on', 'home', 'locked', 'open') else 0
                db.execute(
                    "UPDATE ha_devices SET is_on = ?, status = ? WHERE id = ?",
                    (is_on, state, dev["id"]),
                )

        # Sync scenes from HA — discover and upsert
        ha_scene_entities = {k: v for k, v in all_states.items() if k.startswith('scene.')}
        local_scenes = db.execute("SELECT id, entity_id, name FROM ha_scenes").fetchall()
        local_scene_map = {s["entity_id"]: s for s in local_scenes}

        for entity_id in ha_scene_entities:
            if entity_id in local_scene_map:
                # Update existing scene's favorite status preserved, just keep it current
                pass
            else:
                # New scene discovered — extract a friendly name from entity_id
                friendly_name = entity_id.replace('scene.', '').replace('_', ' ').title()
                db.execute(
                    "INSERT INTO ha_scenes (entity_id, name, icon, is_favorite, sort_order) VALUES (?, ?, ?, 0, 0)",
                    (entity_id, friendly_name, 'scene'),
                )

        db.execute(
            "UPDATE ha_config SET last_synced = datetime('now') WHERE id = 1",
        )
        db.commit()
        asyncio.create_task(_emit('ha-devices'))
        asyncio.create_task(_emit('ha-scenes'))

        rows = db.execute("SELECT * FROM ha_devices ORDER BY sort_order ASC").fetchall()
        return [dict(r) for r in rows]
    finally:
        db.close()

@router.put("/devices/{device_id}/toggle")
async def toggle_ha_device(device_id: int):
    """Toggle a device's state via HA API and update local state."""
    db = get_db()
    try:
        dev = db.execute("SELECT * FROM ha_devices WHERE id = ?", (device_id,)).fetchone()
        if not dev:
            raise HTTPException(status_code=404, detail="Device not found")
        dev = dict(dev)

        config = db.execute("SELECT url, api_key FROM ha_config WHERE id = 1").fetchone()
        if not config or not config["url"] or not config["api_key"]:
            raise HTTPException(status_code=400, detail="HA connection not configured")

        base_url = config["url"].rstrip('/')
        api_key = config["api_key"]
        entity_id = dev["entity_id"]
        current_state = bool(dev["is_on"])

        # Determine the service call based on device type
        success = False
        if dev["device_type"] == "switch":
            action = "off" if current_state else "on"
            success = await _ha_call_service("switch", action, entity_id, base_url, api_key)
        elif dev["device_type"] == "light":
            action = "off" if current_state else "on"
            success = await _ha_call_service("light", action, entity_id, base_url, api_key)
        elif dev["device_type"] == "fan":
            action = "off" if current_state else "on"
            success = await _ha_call_service("fan", action, entity_id, base_url, api_key)
        elif dev["device_type"] == "lock":
            action = "unlock" if current_state else "lock"
            success = await _ha_call_service("lock", action, entity_id, base_url, api_key)
        elif dev["device_type"] == "climate":
            raise HTTPException(status_code=400, detail="Cannot toggle climate device directly")
        else:
            # Default: try switch domain
            action = "off" if current_state else "on"
            success = await _ha_call_service("switch", action, entity_id, base_url, api_key)

        if not success:
            raise HTTPException(status_code=502, detail="Failed to control device via Home Assistant")

        # Optimistically update local state
        new_is_on = 0 if current_state else 1
        new_status = "on" if new_is_on else "off"
        db.execute(
            "UPDATE ha_devices SET is_on = ?, status = ? WHERE id = ?",
            (new_is_on, new_status, device_id),
        )
        db.commit()
        asyncio.create_task(_emit('ha-devices'))

        row = db.execute("SELECT * FROM ha_devices WHERE id = ?", (device_id,)).fetchone()
        return dict(row)
    finally:
        db.close()

@router.get("/entities")
async def list_ha_entities():
    """List all available HA entities (for discovery)."""
    db = get_db()
    try:
        config = db.execute("SELECT url, api_key FROM ha_config WHERE id = 1").fetchone()
        if not config or not config["url"] or not config["api_key"]:
            raise HTTPException(status_code=400, detail="HA connection not configured")

        base_url = config["url"].rstrip('/')
        api_key = config["api_key"]

        all_states = await _ha_fetch_all_states(base_url, api_key)
        if not all_states:
            raise HTTPException(status_code=502, detail="Failed to reach Home Assistant")

        # Get registered entity IDs to mark them
        registered = set()
        rows = db.execute("SELECT entity_id FROM ha_devices").fetchall()
        for r in rows:
            registered.add(r["entity_id"])

        result = []
        for entity_id, state in sorted(all_states.items()):
            domain = entity_id.split('.')[0]
            result.append({
                "entity_id": entity_id,
                "state": state,
                "domain": domain,
                "registered": entity_id in registered,
            })
        return result
    finally:
        db.close()

# ---------------------------------------------------------------------------
# Routes — Scenes CRUD
# ---------------------------------------------------------------------------

@router.get("/scenes")
async def list_ha_scenes():
    db = get_db()
    try:
        rows = db.execute("SELECT * FROM ha_scenes ORDER BY sort_order ASC").fetchall()
        return [dict(r) for r in rows]
    finally:
        db.close()

@router.post("/scenes", status_code=201)
async def create_ha_scene(data: HaSceneCreate):
    db = get_db()
    try:
        cursor = db.execute(
            "INSERT INTO ha_scenes (entity_id, name, icon, is_favorite, sort_order) VALUES (?, ?, ?, ?, ?)",
            (data.entity_id, data.name, data.icon, 1 if data.is_favorite else 0, data.sort_order or 0),
        )
        db.commit()
        asyncio.create_task(_emit('ha-scenes'))
        row = db.execute("SELECT * FROM ha_scenes WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return dict(row)
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="Entity ID already exists")
    finally:
        db.close()

@router.put("/scenes/{scene_id}")
async def update_ha_scene(scene_id: int, data: HaSceneUpdate):
    db = get_db()
    try:
        updates, params = [], []
        if data.name is not None:
            updates.append("name = ?"); params.append(data.name)
        if data.icon is not None:
            updates.append("icon = ?"); params.append(data.icon)
        if data.is_favorite is not None:
            updates.append("is_favorite = ?"); params.append(1 if data.is_favorite else 0)
        if data.sort_order is not None:
            updates.append("sort_order = ?"); params.append(data.sort_order)
        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")
        params.append(scene_id)
        db.execute(f"UPDATE ha_scenes SET {', '.join(updates)} WHERE id = ?", params)
        db.commit()
        asyncio.create_task(_emit('ha-scenes'))
        row = db.execute("SELECT * FROM ha_scenes WHERE id = ?", (scene_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Scene not found")
        return dict(row)
    finally:
        db.close()

@router.delete("/scenes/{scene_id}")
async def delete_ha_scene(scene_id: int):
    db = get_db()
    try:
        db.execute("DELETE FROM ha_scenes WHERE id = ?", (scene_id,))
        db.commit()
        asyncio.create_task(_emit('ha-scenes'))
        return {"deleted": scene_id}
    finally:
        db.close()

# NOTE: /reorder must come BEFORE /{scene_id}/activate or FastAPI treats "reorder" as a scene_id
@router.put("/scenes/reorder")
async def reorder_ha_scenes(data: ReorderRequest):
    db = get_db()
    try:
        for index, sid in enumerate(data.order):
            db.execute("UPDATE ha_scenes SET sort_order = ? WHERE id = ?", (index, sid))
        db.commit()
        asyncio.create_task(_emit('ha-scenes'))
        rows = db.execute("SELECT * FROM ha_scenes ORDER BY sort_order ASC").fetchall()
        return [dict(r) for r in rows]
    finally:
        db.close()

@router.post("/scenes/{scene_id}/activate")
async def activate_ha_scene(scene_id: int):
    """Activate a scene via HA API."""
    db = get_db()
    try:
        scene = db.execute("SELECT * FROM ha_scenes WHERE id = ?", (scene_id,)).fetchone()
        if not scene:
            raise HTTPException(status_code=404, detail="Scene not found")
        scene = dict(scene)

        config = db.execute("SELECT url, api_key FROM ha_config WHERE id = 1").fetchone()
        if not config or not config["url"] or not config["api_key"]:
            raise HTTPException(status_code=400, detail="HA connection not configured")

        base_url = config["url"].rstrip('/')
        api_key = config["api_key"]

        success = await _ha_call_service("scene", "turn_on", scene["entity_id"], base_url, api_key)
        if not success:
            raise HTTPException(status_code=502, detail="Failed to activate scene via Home Assistant")

        return {"status": "activated"}
    finally:
        db.close()

# ---------------------------------------------------------------------------
# Periodic sync task (started from main.py startup)
# ---------------------------------------------------------------------------

async def periodic_ha_sync(broadcast_fn):
    """Background task: sync HA device states every 30 seconds."""
    while True:
        await asyncio.sleep(30)
        try:
            db = get_db()
            config = db.execute("SELECT url, api_key FROM ha_config WHERE id = 1").fetchone()
            db.close()
            if not config or not config["url"] or not config["api_key"]:
                continue

            base_url = config["url"].rstrip('/')
            api_key = config["api_key"]
            all_states = await _ha_fetch_all_states(base_url, api_key)
            if not all_states:
                continue

            db = get_db()
            devices = db.execute("SELECT id, entity_id FROM ha_devices").fetchall()
            changed = False
            for dev in devices:
                state = all_states.get(dev["entity_id"])
                if state is not None:
                    is_on = 1 if state in ('on', 'home', 'locked', 'open') else 0
                    db.execute(
                        "UPDATE ha_devices SET is_on = ?, status = ? WHERE id = ?",
                        (is_on, state, dev["id"]),
                    )
                    changed = True

            if changed:
                db.execute(
                    "UPDATE ha_config SET last_synced = datetime('now') WHERE id = 1",
                )
                db.commit()
                await broadcast_fn('ha-devices')
            else:
                db.commit()
        except Exception as e:
            print(f"Periodic HA sync error: {e}")
        finally:
            try:
                db.close()
            except NameError:
                pass
