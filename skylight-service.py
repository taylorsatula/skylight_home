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
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
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
        # Health check
        # ---------------------------------------------------------------------
        elif self.path == '/api/health':
            self._send_json({
                'status': 'ok',
                'services': ['devices', 'recipe'],
                'devices_configured': len(get_device_config()),
                'recipe_updated': recipe_cache.get('updated', 0)
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
    print("  GET  /api/devices          - All device status")
    print("  GET  /api/device/<id>      - Single device status")
    print("  POST /api/device/<id>/<action> - Control device")
    print("  GET  /api/recipe           - Current recipe")
    print("  GET  /api/recipe/refresh   - Force recipe refresh")
    print("  GET  /api/health           - Service health check")
    print()

    server = HTTPServer(('0.0.0.0', PORT), SkylightHandler)
    server.serve_forever()
