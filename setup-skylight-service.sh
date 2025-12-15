#!/bin/bash
# Run this on the Pi as mira_service user

echo "=== Stopping old services ==="
pkill -f recipe-service.py 2>/dev/null || true
pkill -f device-server.py 2>/dev/null || true

echo "=== Disabling old systemd services ==="
sudo systemctl stop recipe-service 2>/dev/null || true
sudo systemctl disable recipe-service 2>/dev/null || true
sudo systemctl stop device-server 2>/dev/null || true
sudo systemctl disable device-server 2>/dev/null || true

echo "=== Creating skylight-service systemd unit ==="
sudo tee /etc/systemd/system/skylight-service.service << 'EOF'
[Unit]
Description=Skylight Home Unified Service
After=network.target

[Service]
Type=simple
User=mira_service
WorkingDirectory=/home/mira_service/kiosk
ExecStart=/home/mira_service/kiosk/venv/bin/python /home/mira_service/kiosk/skylight-service.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

echo "=== Enabling and starting skylight-service ==="
sudo systemctl daemon-reload
sudo systemctl enable skylight-service
sudo systemctl start skylight-service

echo "=== Status ==="
sudo systemctl status skylight-service

echo "=== Done ==="
