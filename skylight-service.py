#!/usr/bin/env python3
"""
Skylight Home Unified Service
Runs on Pi: python3 skylight-service.py

Combines:
- Kasa/Tapo device control
- NYT Cooking recipe scraping

API available at http://localhost:8889
"""

import asyncio
import json
import time
import re
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.request import urlopen, Request
from pathlib import Path

# =============================================================================
# CONFIGURATION
# =============================================================================

CONFIG_FILE = Path(__file__).parent / 'config.json'

def load_config():
    """Load configuration from config.json"""
    try:
        with open(CONFIG_FILE, 'r') as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading config: {e}")
        return {}

CONFIG = load_config()


# =============================================================================
# =============================================================================
#
#   DEVICE CONTROL SERVICE
#   Kasa/Tapo smart device control
#
# =============================================================================
# =============================================================================

from kasa import Discover, Credentials

def get_device_config():
    """Get device configuration from config"""
    return CONFIG.get('devices', {})

def get_tapo_credentials():
    """Get Tapo credentials from config"""
    creds = CONFIG.get('tapo', {})
    return Credentials(creds.get('username', ''), creds.get('password', ''))

device_cache = {}

async def get_device(device_id, force_reconnect=False):
    """Get or create device connection"""
    devices = get_device_config()
    ip = devices.get(device_id)
    if not ip:
        return None
    if force_reconnect and device_id in device_cache:
        del device_cache[device_id]
    if device_id not in device_cache:
        credentials = get_tapo_credentials()
        dev = await Discover.discover_single(ip, credentials=credentials, timeout=10)
        device_cache[device_id] = dev
    return device_cache[device_id]

async def get_device_status(device_id):
    """Get status of a single device"""
    try:
        dev = await get_device(device_id)
        if not dev:
            return {"error": "Device not found"}
        await dev.update()
        devices = get_device_config()
        result = {
            "id": device_id,
            "ip": devices[device_id],
            "name": dev.alias or device_id,
            "model": dev.model,
            "is_on": dev.is_on,
        }
        if hasattr(dev, 'brightness'):
            result["brightness"] = dev.brightness
        if hasattr(dev, 'color_temp'):
            result["color_temp"] = dev.color_temp
        if hasattr(dev, 'hsv'):
            result["hsv"] = dev.hsv
        return result
    except Exception as e:
        if device_id in device_cache:
            del device_cache[device_id]
        return {"error": str(e), "id": device_id}

async def get_all_device_status():
    """Get status of all configured devices"""
    devices = get_device_config()
    results = {}
    for did in devices:
        results[did] = await get_device_status(did)
        await asyncio.sleep(0.2)  # Small delay between devices
    return results

async def control_device(device_id, action, value=None):
    """Control a device (on/off/toggle/brightness)"""
    try:
        dev = await get_device(device_id)
        if not dev:
            return {"error": "Device not found"}

        if action == "on":
            await dev.turn_on()
        elif action == "off":
            await dev.turn_off()
        elif action == "toggle":
            if dev.is_on:
                await dev.turn_off()
            else:
                await dev.turn_on()
        elif action == "brightness" and value is not None:
            if hasattr(dev, 'set_brightness'):
                await dev.set_brightness(int(value))
        elif action == "color_temp" and value is not None:
            if hasattr(dev, 'set_color_temp'):
                await dev.set_color_temp(int(value))

        await dev.update()
        return await get_device_status(device_id)
    except Exception as e:
        return {"error": str(e)}


# =============================================================================
# =============================================================================
#
#   RECIPE SERVICE
#   NYT Cooking recipe of the day scraper
#
# =============================================================================
# =============================================================================

RECIPE_CACHE_FILE = '/tmp/nyt_recipe_cache.json'
RECIPE_UPDATE_INTERVAL = 3600  # 1 hour


# =============================================================================
# =============================================================================
#
#   NOTIFICATIONS SERVICE
#   Persistent notifications with recurring reminder support
#
# =============================================================================
# =============================================================================

from datetime import datetime, timedelta
import uuid

NOTIFICATIONS_FILE = Path(__file__).parent / 'notifications.json'

def load_notifications():
    """Load notifications from JSON file"""
    try:
        with open(NOTIFICATIONS_FILE, 'r') as f:
            return json.load(f)
    except:
        return {'notifications': [], 'recurring': []}

def save_notifications(data):
    """Save notifications to JSON file"""
    try:
        with open(NOTIFICATIONS_FILE, 'w') as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        print(f"Error saving notifications: {e}")

def get_active_notifications():
    """Get all active notifications including triggered recurring ones"""
    data = load_notifications()
    now = datetime.now()
    active = []

    # One-time notifications that haven't expired
    for notif in data.get('notifications', []):
        expires = notif.get('expires')
        if expires:
            exp_dt = datetime.fromisoformat(expires)
            if exp_dt < now:
                continue
        active.append(notif)

    # Check recurring reminders
    for recur in data.get('recurring', []):
        triggered = check_recurring_trigger(recur, now)
        if triggered:
            active.append(triggered)

    # Sort by priority (urgent first)
    priority_order = {'urgent': 0, 'normal': 1, 'info': 2}
    active.sort(key=lambda x: priority_order.get(x.get('priority', 'normal'), 1))

    return active

def check_recurring_trigger(recur, now):
    """Check if a recurring reminder should show now"""
    rule = recur.get('rule', {})
    show_before = rule.get('show_before_hours', 0)

    # Calculate target time
    if 'weekday' in rule:
        # Weekly recurring (0=Monday, 6=Sunday)
        target_weekday = rule['weekday']
        target_hour = rule.get('hour', 8)  # Default 8 AM

        # Find next occurrence of this weekday
        days_until = (target_weekday - now.weekday()) % 7
        if days_until == 0 and now.hour >= target_hour:
            days_until = 7  # Already passed today

        target_dt = now.replace(hour=target_hour, minute=0, second=0, microsecond=0) + timedelta(days=days_until)
        show_from = target_dt - timedelta(hours=show_before)

        # Check if we're in the show window
        if show_from <= now < target_dt:
            return {
                'id': recur['id'],
                'title': recur.get('title', 'Reminder'),
                'message': recur.get('message', ''),
                'priority': recur.get('priority', 'normal'),
                'icon': recur.get('icon', 'alert'),
                'recurring': True,
                'target_time': target_dt.isoformat()
            }

    elif 'day_of_month' in rule:
        # Monthly recurring
        target_day = rule['day_of_month']
        target_hour = rule.get('hour', 8)

        # This month or next?
        if now.day > target_day or (now.day == target_day and now.hour >= target_hour):
            # Next month
            if now.month == 12:
                target_dt = now.replace(year=now.year + 1, month=1, day=target_day, hour=target_hour, minute=0, second=0, microsecond=0)
            else:
                target_dt = now.replace(month=now.month + 1, day=target_day, hour=target_hour, minute=0, second=0, microsecond=0)
        else:
            target_dt = now.replace(day=target_day, hour=target_hour, minute=0, second=0, microsecond=0)

        show_from = target_dt - timedelta(hours=show_before)

        if show_from <= now < target_dt:
            return {
                'id': recur['id'],
                'title': recur.get('title', 'Reminder'),
                'message': recur.get('message', ''),
                'priority': recur.get('priority', 'normal'),
                'icon': recur.get('icon', 'alert'),
                'recurring': True,
                'target_time': target_dt.isoformat()
            }

    return None

def add_notification(notif_data):
    """Add a new notification"""
    data = load_notifications()

    notif = {
        'id': notif_data.get('id', str(uuid.uuid4())[:8]),
        'title': notif_data.get('title', 'Notification'),
        'message': notif_data.get('message', ''),
        'priority': notif_data.get('priority', 'normal'),  # urgent, normal, info
        'icon': notif_data.get('icon', 'alert'),
        'created': datetime.now().isoformat()
    }

    # Handle expiration
    if notif_data.get('expires_hours'):
        notif['expires'] = (datetime.now() + timedelta(hours=notif_data['expires_hours'])).isoformat()
    elif notif_data.get('expires'):
        notif['expires'] = notif_data['expires']

    data['notifications'].append(notif)
    save_notifications(data)
    return notif

def add_recurring(recur_data):
    """Add a recurring reminder"""
    data = load_notifications()

    recur = {
        'id': recur_data.get('id', str(uuid.uuid4())[:8]),
        'title': recur_data.get('title', 'Reminder'),
        'message': recur_data.get('message', ''),
        'priority': recur_data.get('priority', 'normal'),
        'icon': recur_data.get('icon', 'alert'),
        'rule': recur_data.get('rule', {})
    }

    data['recurring'].append(recur)
    save_notifications(data)
    return recur

def delete_notification(notif_id):
    """Delete a notification by ID"""
    data = load_notifications()

    # Remove from one-time notifications
    data['notifications'] = [n for n in data['notifications'] if n.get('id') != notif_id]

    # Also check recurring (allow deleting recurring reminders)
    data['recurring'] = [r for r in data['recurring'] if r.get('id') != notif_id]

    save_notifications(data)
    return {'deleted': notif_id}

recipe_cache = {
    'title': 'Loading...',
    'image': '',
    'url': 'https://cooking.nytimes.com',
    'time': '',
    'servings': '',
    'author': 'NYT Cooking',
    'updated': 0
}

def save_recipe_cache():
    """Save recipe cache to disk"""
    try:
        with open(RECIPE_CACHE_FILE, 'w') as f:
            json.dump(recipe_cache, f)
    except Exception as e:
        print(f"Error saving recipe cache: {e}")

def load_recipe_cache():
    """Load recipe cache from disk"""
    global recipe_cache
    try:
        with open(RECIPE_CACHE_FILE, 'r') as f:
            recipe_cache = json.load(f)
    except:
        pass

def fetch_recipe_details(url):
    """Fetch details from individual recipe page"""
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }
        req = Request(url, headers=headers)
        with urlopen(req, timeout=10) as response:
            html = response.read().decode('utf-8')

        result = {'url': url}

        # Try JSON-LD first
        json_ld_match = re.search(r'<script type="application/ld\+json">(.*?)</script>', html, re.DOTALL)
        if json_ld_match:
            try:
                data = json.loads(json_ld_match.group(1))
                if isinstance(data, list):
                    for item in data:
                        if item.get('@type') == 'Recipe':
                            data = item
                            break
                if data.get('@type') == 'Recipe':
                    img = data.get('image', '')
                    if isinstance(img, dict):
                        img = img.get('url', '')
                    elif isinstance(img, list):
                        img = img[0] if img else ''

                    total_time = data.get('totalTime', '')
                    if total_time:
                        total_time = total_time.replace('PT', '').replace('H', ' hr ').replace('M', ' min').strip()

                    result = {
                        'title': data.get('name', 'Recipe of the Day'),
                        'image': img,
                        'url': url,
                        'time': total_time,
                        'servings': str(data.get('recipeYield', '')),
                        'author': data.get('author', {}).get('name', 'NYT Cooking') if isinstance(data.get('author'), dict) else 'NYT Cooking',
                    }
                    return result
            except json.JSONDecodeError:
                pass

        # Fallback to og tags
        og_title = re.search(r'<meta property="og:title" content="([^"]+)"', html)
        og_image = re.search(r'<meta property="og:image" content="([^"]+)"', html)

        if og_title:
            result['title'] = og_title.group(1)
        if og_image:
            result['image'] = og_image.group(1)

        return result
    except Exception as e:
        print(f"Error fetching recipe details: {e}")
        return None

def fetch_nyt_cooking():
    """Fetch recipe of the day from NYT Cooking"""
    global recipe_cache

    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }
        req = Request('https://cooking.nytimes.com/', headers=headers)

        with urlopen(req, timeout=10) as response:
            html = response.read().decode('utf-8')

        # Find recipe URLs on the homepage
        recipe_urls = re.findall(r'href="(https://cooking\.nytimes\.com/recipes/\d+[^"]*)"', html)
        if not recipe_urls:
            recipe_urls = re.findall(r'href="(/recipes/\d+[^"]*)"', html)
            recipe_urls = ['https://cooking.nytimes.com' + u for u in recipe_urls]

        # Get unique URLs
        seen = set()
        unique_urls = []
        for u in recipe_urls:
            if u not in seen:
                seen.add(u)
                unique_urls.append(u)

        if unique_urls:
            # Fetch details from first (featured) recipe
            details = fetch_recipe_details(unique_urls[0])
            if details:
                recipe_cache = {
                    'title': details.get('title', 'Recipe of the Day'),
                    'image': details.get('image', ''),
                    'url': details.get('url', unique_urls[0]),
                    'time': details.get('time', ''),
                    'servings': details.get('servings', ''),
                    'author': details.get('author', 'NYT Cooking'),
                    'updated': int(time.time())
                }
                save_recipe_cache()
                print(f"[Recipe] Updated: {recipe_cache['title']}")
                return

        # Fallback to og tags from homepage
        og_title = re.search(r'<meta property="og:title" content="([^"]+)"', html)
        og_image = re.search(r'<meta property="og:image" content="([^"]+)"', html)

        if og_title:
            recipe_cache['title'] = og_title.group(1)
        if og_image:
            recipe_cache['image'] = og_image.group(1)
        recipe_cache['updated'] = int(time.time())
        save_recipe_cache()
        print(f"[Recipe] Updated (og tags): {recipe_cache['title']}")

    except Exception as e:
        print(f"[Recipe] Error fetching: {e}")

def recipe_update_loop():
    """Background thread to update recipe periodically"""
    while True:
        fetch_nyt_cooking()
        time.sleep(RECIPE_UPDATE_INTERVAL)


# =============================================================================
# =============================================================================
#
#   HTTP SERVER
#   Unified request handler for all endpoints
#
# =============================================================================
# =============================================================================

class SkylightHandler(BaseHTTPRequestHandler):
    """Unified HTTP handler for all Skylight services"""

    def _send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_OPTIONS(self):
        self._send_json({})

    def do_GET(self):
        # ---------------------------------------------------------------------
        # Device endpoints
        # ---------------------------------------------------------------------
        if self.path == '/api/devices':
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            result = loop.run_until_complete(get_all_device_status())
            loop.close()
            self._send_json(result)

        elif self.path.startswith('/api/device/'):
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            device_id = self.path.split('/')[3]
            result = loop.run_until_complete(get_device_status(device_id))
            loop.close()
            self._send_json(result)

        # ---------------------------------------------------------------------
        # Recipe endpoints
        # ---------------------------------------------------------------------
        elif self.path == '/api/recipe':
            self._send_json(recipe_cache)

        elif self.path == '/api/recipe/refresh':
            fetch_nyt_cooking()
            self._send_json(recipe_cache)

        # ---------------------------------------------------------------------
        # Notification endpoints
        # ---------------------------------------------------------------------
        elif self.path == '/api/notifications':
            self._send_json(get_active_notifications())

        elif self.path == '/api/notifications/all':
            # Return raw data including recurring rules (for management)
            self._send_json(load_notifications())

        # ---------------------------------------------------------------------
        # Health check
        # ---------------------------------------------------------------------
        elif self.path == '/api/health':
            notif_data = load_notifications()
            self._send_json({
                'status': 'ok',
                'services': ['devices', 'recipe', 'notifications'],
                'devices_configured': len(get_device_config()),
                'recipe_updated': recipe_cache.get('updated', 0),
                'notifications_count': len(notif_data.get('notifications', [])),
                'recurring_count': len(notif_data.get('recurring', []))
            })

        else:
            self._send_json({'error': 'Not found'}, 404)

    def do_POST(self):
        # ---------------------------------------------------------------------
        # Device control endpoints
        # ---------------------------------------------------------------------
        if self.path.startswith('/api/device/'):
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode() if content_length else '{}'
            data = json.loads(body) if body else {}

            parts = self.path.split('/')
            device_id = parts[3]
            action = parts[4] if len(parts) > 4 else 'toggle'
            value = data.get('value')

            result = loop.run_until_complete(control_device(device_id, action, value))
            loop.close()
            self._send_json(result)

        # ---------------------------------------------------------------------
        # Notification endpoints
        # ---------------------------------------------------------------------
        elif self.path == '/api/notifications':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode() if content_length else '{}'
            data = json.loads(body) if body else {}
            result = add_notification(data)
            self._send_json(result)

        elif self.path == '/api/notifications/recurring':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode() if content_length else '{}'
            data = json.loads(body) if body else {}
            result = add_recurring(data)
            self._send_json(result)

        else:
            self._send_json({'error': 'Not found'}, 404)

    def do_DELETE(self):
        # ---------------------------------------------------------------------
        # Delete notification
        # ---------------------------------------------------------------------
        if self.path.startswith('/api/notifications/'):
            notif_id = self.path.split('/')[-1]
            result = delete_notification(notif_id)
            self._send_json(result)
        else:
            self._send_json({'error': 'Not found'}, 404)

    def log_message(self, format, *args):
        pass  # Suppress default logging


# =============================================================================
# =============================================================================
#
#   MAIN ENTRY POINT
#
# =============================================================================
# =============================================================================

if __name__ == '__main__':
    PORT = 8889

    # Load recipe cache
    load_recipe_cache()

    # Start recipe update background thread
    recipe_thread = threading.Thread(target=recipe_update_loop, daemon=True)
    recipe_thread.start()

    # Print startup info
    print("=" * 60)
    print("  Skylight Home Service")
    print("=" * 60)
    print(f"  Port: {PORT}")
    print(f"  Devices configured: {list(get_device_config().keys())}")
    print(f"  Recipe cache: {recipe_cache.get('title', 'Not loaded')}")
    print("=" * 60)
    print()
    print("Endpoints:")
    print("  GET  /api/devices              - All device status")
    print("  GET  /api/device/<id>          - Single device status")
    print("  POST /api/device/<id>/<action> - Control device")
    print("  GET  /api/recipe               - Current recipe")
    print("  GET  /api/recipe/refresh       - Force recipe refresh")
    print("  GET  /api/notifications        - Active notifications")
    print("  GET  /api/notifications/all    - All notifications (incl. recurring rules)")
    print("  POST /api/notifications        - Add notification")
    print("  POST /api/notifications/recurring - Add recurring reminder")
    print("  DEL  /api/notifications/<id>   - Delete notification")
    print("  GET  /api/health               - Service health check")
    print()

    server = HTTPServer(('0.0.0.0', PORT), SkylightHandler)
    server.serve_forever()
