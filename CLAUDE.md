# Skylight Home Dashboard

## Deployment to Raspberry Pi

The dashboard runs on a Raspberry Pi kiosk.

### Connection Details
- **Host:** 192.168.1.137
- **User:** mira_service
- **Deployment Path:** ~/kiosk/

### SSH Access
SSH key authentication is configured. No password required.

### Deploy Commands

Deploy all frontend files:
```bash
scp index.html style.css mira_service@192.168.1.137:~/kiosk/
```

Deploy just index.html:
```bash
scp index.html mira_service@192.168.1.137:~/kiosk/
```

SSH into the Pi:
```bash
ssh mira_service@192.168.1.137
```
