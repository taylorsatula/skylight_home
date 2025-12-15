#!/bin/bash

# Skylight Calendar Kiosk Setup Script
# Place Nova.apk and Fully.xapk in the same directory as this script
# Optionally place index.html and style.css for local server mode

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NOVA_APK="$SCRIPT_DIR/Nova.apk"
FULLY_XAPK="$SCRIPT_DIR/Fully.xapk"
TEMP_DIR="$SCRIPT_DIR/fully-extracted"
LOCAL_PORT=8888

echo "=== Skylight Calendar Kiosk Setup ==="
echo ""

# Check for required files
if [[ ! -f "$NOVA_APK" ]]; then
    echo "ERROR: Nova.apk not found in $SCRIPT_DIR"
    exit 1
fi

if [[ ! -f "$FULLY_XAPK" ]]; then
    echo "ERROR: Fully.xapk not found in $SCRIPT_DIR"
    exit 1
fi

# Check for ADB
if ! command -v adb &> /dev/null; then
    echo "ERROR: adb not found. Please install Android platform tools."
    exit 1
fi

# Ask for start URL
echo "Enter the start URL for Fully Kiosk Browser."
echo "Leave blank to start a local server on port $LOCAL_PORT."
echo ""
read -p "Start URL: " START_URL

if [[ -z "$START_URL" ]]; then
    USE_LOCAL_SERVER=true
    START_URL="http://localhost:$LOCAL_PORT/index.html"
    echo ""
    echo "Using local server mode: $START_URL"

    # Check for HTML files
    if [[ ! -f "$SCRIPT_DIR/index.html" ]]; then
        echo "WARNING: index.html not found in $SCRIPT_DIR"
        echo "         You'll need to push HTML files to /sdcard/kiosk/ manually"
    fi
else
    USE_LOCAL_SERVER=false
    echo ""
    echo "Using remote URL: $START_URL"
fi

echo ""

# Wait for device
echo "[1/8] Waiting for device..."
adb wait-for-device
echo "       Device connected!"

# Get root access
echo "[2/8] Getting root access..."
adb root
sleep 3

# Verify device is accessible
DEVICE_MODEL=$(adb shell getprop ro.product.model 2>/dev/null || echo "unknown")
echo "       Connected to: $DEVICE_MODEL"

# Install Nova Launcher
echo "[3/8] Installing Nova Launcher..."
adb install -r "$NOVA_APK"
echo "       Nova Launcher installed!"

# Extract Fully XAPK
echo "[4/8] Extracting Fully Kiosk Browser..."
rm -rf "$TEMP_DIR"
mkdir -p "$TEMP_DIR"
unzip -q "$FULLY_XAPK" -d "$TEMP_DIR"
echo "       Extracted!"

# Install Fully Kiosk (split APKs)
echo "[5/8] Installing Fully Kiosk Browser..."
APKS_TO_INSTALL=("$TEMP_DIR/de.ozerov.fully.apk")

# Add architecture-specific APK
if [[ -f "$TEMP_DIR/config.arm64_v8a.apk" ]]; then
    APKS_TO_INSTALL+=("$TEMP_DIR/config.arm64_v8a.apk")
elif [[ -f "$TEMP_DIR/config.armeabi_v7a.apk" ]]; then
    APKS_TO_INSTALL+=("$TEMP_DIR/config.armeabi_v7a.apk")
fi

# Add English language APK
if [[ -f "$TEMP_DIR/config.en.apk" ]]; then
    APKS_TO_INSTALL+=("$TEMP_DIR/config.en.apk")
fi

# Add density APK
if [[ -f "$TEMP_DIR/config.xxhdpi.apk" ]]; then
    APKS_TO_INSTALL+=("$TEMP_DIR/config.xxhdpi.apk")
elif [[ -f "$TEMP_DIR/config.xhdpi.apk" ]]; then
    APKS_TO_INSTALL+=("$TEMP_DIR/config.xhdpi.apk")
fi

adb install-multiple "${APKS_TO_INSTALL[@]}"
echo "       Fully Kiosk Browser installed!"

# Disable Skylight apps
echo "[6/8] Disabling Skylight apps..."
adb shell "pm disable com.skylight 2>/dev/null || true"
adb shell "pm disable skylight.watchdog 2>/dev/null || true"
echo "       Skylight apps disabled!"

# Set up local server if needed
echo "[7/8] Configuring start URL..."
if [[ "$USE_LOCAL_SERVER" == true ]]; then
    echo "       Setting up local server..."

    # Create kiosk directory on device
    adb shell "mkdir -p /sdcard/kiosk"

    # Push HTML files if they exist
    if [[ -f "$SCRIPT_DIR/index.html" ]]; then
        adb push "$SCRIPT_DIR/index.html" /sdcard/kiosk/
    fi
    if [[ -f "$SCRIPT_DIR/style.css" ]]; then
        adb push "$SCRIPT_DIR/style.css" /sdcard/kiosk/
    fi
    if [[ -f "$SCRIPT_DIR/manifest.json" ]]; then
        adb push "$SCRIPT_DIR/manifest.json" /sdcard/kiosk/
    fi

    # Create boot server script
    adb shell "cat > /sdcard/kiosk/start-server.sh << 'SERVEREOF'
#!/system/bin/sh
cd /sdcard/kiosk
am startservice --user 0 -n de.ozerov.fully/.HttpServerService 2>/dev/null || /system/bin/toybox httpd -p $LOCAL_PORT -h /sdcard/kiosk
SERVEREOF"

    # Create init script that runs on boot
    adb remount 2>/dev/null || true
    adb shell "cat > /data/local/tmp/kiosk-server.sh << 'BOOTEOF'
#!/system/bin/sh
while true; do
    cd /sdcard/kiosk
    /system/bin/toybox httpd -p $LOCAL_PORT -h /sdcard/kiosk -f
    sleep 5
done
BOOTEOF"
    adb shell "chmod 755 /data/local/tmp/kiosk-server.sh"

    # Add to init.d if available, otherwise use a different method
    adb shell "mkdir -p /data/adb/service.d 2>/dev/null || true"
    adb shell "cat > /data/adb/service.d/kiosk-server.sh << 'INITEOF'
#!/system/bin/sh
sleep 30
cd /sdcard/kiosk
while true; do
    /system/bin/toybox httpd -p $LOCAL_PORT -h /sdcard/kiosk -f 2>/dev/null || busybox httpd -p $LOCAL_PORT -h /sdcard/kiosk -f 2>/dev/null
    sleep 5
done &
INITEOF"
    adb shell "chmod 755 /data/adb/service.d/kiosk-server.sh 2>/dev/null || true"

    # Start the server now
    adb shell "cd /sdcard/kiosk && nohup /system/bin/toybox httpd -p $LOCAL_PORT -h /sdcard/kiosk -f > /dev/null 2>&1 &" || true

    echo "       Local server configured on port $LOCAL_PORT"
fi

# Configure Fully Kiosk start URL
# Launch Fully once to create preferences, then modify them
adb shell "am start -n de.ozerov.fully/.FullyKioskActivity" 2>/dev/null || \
adb shell "monkey -p de.ozerov.fully -c android.intent.category.LAUNCHER 1" 2>/dev/null || true
sleep 3
adb shell "am force-stop de.ozerov.fully"

# Set the start URL in Fully's preferences
adb shell "mkdir -p /data/data/de.ozerov.fully/shared_prefs"
adb shell "cat > /data/data/de.ozerov.fully/shared_prefs/fully_preferences.xml << PREFSEOF
<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
    <string name=\"startURL\">$START_URL</string>
    <boolean name=\"showNavigationBar\" value=\"false\" />
    <boolean name=\"showStatusBar\" value=\"false\" />
    <boolean name=\"showActionBar\" value=\"false\" />
    <boolean name=\"kioskMode\" value=\"true\" />
    <boolean name=\"kioskModeEnabled\" value=\"true\" />
    <boolean name=\"keepScreenOn\" value=\"true\" />
    <boolean name=\"autoStartOnBoot\" value=\"true\" />
    <boolean name=\"autoStartAfterCrash\" value=\"true\" />
</map>
PREFSEOF"
adb shell "chmod 660 /data/data/de.ozerov.fully/shared_prefs/fully_preferences.xml"
adb shell "chown system:system /data/data/de.ozerov.fully/shared_prefs/fully_preferences.xml 2>/dev/null || true"

echo "       Start URL set to: $START_URL"

# Disable Nova and set Fully as launcher
echo "[8/8] Setting Fully Kiosk as default launcher..."
adb shell "pm disable com.teslacoilsw.launcher"
adb shell "am start -a android.intent.action.MAIN -c android.intent.category.HOME"
echo "       Fully Kiosk set as launcher!"

# Cleanup
rm -rf "$TEMP_DIR"

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Fully Kiosk Browser is now the default launcher."
echo "Start URL: $START_URL"
echo ""
if [[ "$USE_LOCAL_SERVER" == true ]]; then
    echo "Local server running on port $LOCAL_PORT"
    echo "HTML files location: /sdcard/kiosk/"
    echo ""
fi
echo "To re-enable Nova Launcher later:"
echo "  adb shell pm enable com.teslacoilsw.launcher"
echo ""
