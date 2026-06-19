#!/bin/bash

# Skylight Calendar Kiosk Setup Script
# Place Nova.apk and Fully.xapk in the same directory as this script.
# The dashboard must be served from the Pi (port 8894) — no local file serving.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NOVA_APK="$SCRIPT_DIR/Nova.apk"
FULLY_XAPK="$SCRIPT_DIR/Fully.xapk"
TEMP_DIR="$SCRIPT_DIR/fully-extracted"

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

# Ask for the Pi's IP address
echo "Enter the IP address of the Pi hosting the Skylight backend."
echo "The dashboard will be served at http://<ip>:8894"
echo ""
read -p "Pi IP address: " PI_IP

if [[ -z "$PI_IP" ]]; then
    echo "ERROR: Pi IP address is required."
    exit 1
fi

START_URL="http://${PI_IP}:8894"

echo ""

# Wait for device
echo "[1/7] Waiting for device..."
adb wait-for-device
echo "       Device connected!"

# Get root access
echo "[2/7] Getting root access..."
adb root
sleep 3

# Verify device is accessible
DEVICE_MODEL=$(adb shell getprop ro.product.model 2>/dev/null || echo "unknown")
echo "       Connected to: $DEVICE_MODEL"

# Install Nova Launcher
echo "[3/7] Installing Nova Launcher..."
adb install -r "$NOVA_APK"
echo "       Nova Launcher installed!"

# Extract Fully XAPK
echo "[4/7] Extracting Fully Kiosk Browser..."
rm -rf "$TEMP_DIR"
mkdir -p "$TEMP_DIR"
unzip -q "$FULLY_XAPK" -d "$TEMP_DIR"
echo "       Extracted!"

# Install Fully Kiosk (split APKs)
echo "[5/7] Installing Fully Kiosk Browser..."
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
echo "[6/7] Disabling Skylight apps..."
adb shell "pm disable com.skylight 2>/dev/null || true"
adb shell "pm disable skylight.watchdog 2>/dev/null || true"
echo "       Skylight apps disabled!"

# Configure Fully Kiosk start URL
echo "[7/7] Configuring Fully Kiosk..."

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
adb shell "pm disable com.teslacoilsw.launcher"
adb shell "am start -a android.intent.action.MAIN -c android.intent.category.HOME"
echo "       Fully Kiosk set as default launcher!"

# Cleanup
rm -rf "$TEMP_DIR"

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Fully Kiosk Browser is now the default launcher."
echo "Dashboard served from: $START_URL"
echo ""
echo "To re-enable Nova Launcher later:"
echo "  adb shell pm enable com.teslacoilsw.launcher"
echo ""
