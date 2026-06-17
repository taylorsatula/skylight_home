#!/bin/bash
# Skylight Home Backend - Setup Script
# Run on the Raspberry Pi as mira_service user

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_NAME="skylight-backend"
VENV_DIR="$SCRIPT_DIR/.venv"
PIDFILE="/tmp/${SERVICE_NAME}.pid"

echo "=== Skylight Home Backend Setup ==="

# Create virtual environment
if [ ! -d "$VENV_DIR" ]; then
  echo "Creating virtual environment..."
  python3 -m venv "$VENV_DIR"
fi

# Activate and install dependencies
echo "Installing dependencies..."
source "$VENV_DIR/bin/activate"
pip install --upgrade pip
pip install -r "$SCRIPT_DIR/requirements.txt"

# Create data directory
mkdir -p "$SCRIPT_DIR/data/photos"

# Install systemd service
echo "Installing systemd service..."
sudo cp "$SCRIPT_DIR/skylight-backend.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable $SERVICE_NAME

echo ""
echo "Setup complete!"
echo ""
echo "To start the service:"
echo "  sudo systemctl start $SERVICE_NAME"
echo ""
echo "To check status:"
echo "  sudo systemctl status $SERVICE_NAME"
echo ""
echo "To view logs:"
echo "  journalctl -u $SERVICE_NAME -f"
echo ""
echo "The admin panel will be available at: http://<pi-ip>:8894"
echo ""
echo "IMPORTANT: Set TMDB_API_KEY for movie search functionality:"
echo "  sudo systemctl edit $SERVICE_NAME"
echo "  # Add: Environment=TMDB_API_KEY=your_key_here"
