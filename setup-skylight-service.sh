#!/bin/bash
# Skylight Home Backend Setup
# Run on the Raspberry Pi as server_admin user

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
SERVICE_NAME="skylight-backend"

echo "=== Skylight Home Backend Setup ==="

# Create virtual environment
if [ ! -d "$BACKEND_DIR/.venv" ]; then
  echo "Creating virtual environment..."
  python3 -m venv "$BACKEND_DIR/.venv"
fi

# Install dependencies
echo "Installing dependencies..."
source "$BACKEND_DIR/.venv/bin/activate"
pip install --upgrade pip
pip install -r "$BACKEND_DIR/requirements.txt"

# Create data directories
mkdir -p "$BACKEND_DIR/data/photos"
mkdir -p "$BACKEND_DIR/data/posters"

# Install systemd service
echo "Installing systemd service..."
sudo cp "$BACKEND_DIR/skylight-backend.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable $SERVICE_NAME

# Start the service
echo "Starting $SERVICE_NAME..."
sudo systemctl start $SERVICE_NAME

# Show status
sleep 2
echo ""
sudo systemctl status $SERVICE_NAME --no-pager

echo ""
echo "=== Done ==="
echo ""
echo "Dashboard:  http://<pi-ip>:8894"
echo "Admin PWA:  http://<pi-ip>:8894/admin"
echo ""
echo "Set TMDB_API_KEY for movie search:"
echo "  sudo systemctl edit $SERVICE_NAME"
echo "  # Add: Environment=TMDB_API_KEY=your_key_here"
echo ""
echo "View logs:"
echo "  journalctl -u $SERVICE_NAME -f"
echo ""
