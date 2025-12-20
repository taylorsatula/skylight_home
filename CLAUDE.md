# Skylight Home Dashboard

## Deployment to Raspberry Pi
The dashboard runs on a Raspberry Pi kiosk.
The UI is displayed on a rooted Skylight Calendar in a webview

### Connection Details
- **Host:** 192.168.1.137
- **User:** mira_service
- **Deployment Path:** ~/kiosk/

### SSH Access
SSH key authentication is configured. No password required.

### Deploy Commands

Deploy frontend files:
```bash
scp {filename} style.css mira_service@192.168.1.137:~/kiosk/
```

SSH into the Pi:
```bash
ssh mira_service@192.168.1.137
```


## Architecture

**Single-file JS** - All logic in `app.js`, organized by section:
- Global state → Config → Layout Engine → Widget Factory → Home Assistant → Widgets → Modals → Utils → Init

**Configurable Layout** - Dashboard layout defined in `config.json`:
```json
{
  "layout": {
    "topRow": { "tiles": [...] },
    "middleRow": { "tiles": [...] },
    "bottomRow": { "tiles": [...] }
  }
}
```

**Per-tile width** - Each tile can specify its own width:
```json
{ "type": "weather", "width": "400px" }
{ "type": "note", "width": "1fr" }
```

## CSS Guidelines

### Naming: BEM
```css
.widget { }                    /* Block */
.widget__header { }            /* Element */
.widget--active { }            /* Modifier */
.notify-panel__alert--urgent { }
```

### CSS Variables (use these, don't hardcode colors)
```css
/* Backgrounds */
--surface-widget, --surface-glass, --surface-inset

/* Text */
--text-primary (#fff), --text-secondary (60%), --text-muted (35%)

/* Semantic */
--color-accent (#5ac8fa blue)
--color-success (#30d158 green)
--color-warning (#ffd60a yellow)
--color-alert (#ff9f0a orange)
--color-error (#ff453a red)

/* Spacing: xs(4) sm(8) md(12) lg(16) xl(20) 2xl(24) */
/* Radius: sm(8) md(12) lg(16) xl(18) 2xl(22) */
```

### Typography
- System font: `var(--font-family)` - UI elements
- Editorial: `var(--font-editorial)` - Recipe titles only
- Sizes: text-2xs(11) text-xs(13) text-sm(15) text-md(17) text-lg(24) text-xl(34)

## Widget Development

### Creating a new widget

1. Add factory function:
```js
function createMyWidget(config) {
  const widget = document.createElement('div');
  widget.className = 'widget';
  widget.id = 'my-widget';
  widget.innerHTML = `...`;
  return widget;
}
```

2. Register in WIDGET_TYPES:
```js
const WIDGET_TYPES = {
  'myWidget': createMyWidget,
  // ...
};
```

3. Add to config.json layout

### Widget config pattern
Widgets receive their tile config object. Store it if needed for data fetching:
```js
let myWidgetConfig = null;

function createMyWidget(config) {
  myWidgetConfig = config;
  // ...
}

async function fetchMyData() {
  const days = myWidgetConfig?.days || 7;
  // ...
}
```

## Notifications

Priority levels with individual colors:
- `urgent` - Red, pulsing dot
- `normal` - Orange/yellow
- `info` - Blue
- (none) - Green "All Clear" calm state

Max 2 alerts displayed, each with its own color.

## Touch Interactions

- **Tap**: Toggle, select, navigate
- **Long press (500ms)**: Secondary action (brightness modal for lights)
- Always use `pointer-events: none` on child elements to prevent event bubbling
- Include `-webkit-tap-highlight-color: transparent` for touch feedback control

## API Integration Pattern

```js
async function fetchData() {
  const apiUrl = CONFIG.apis?.myApi;
  if (!apiUrl) return;

  try {
    const response = await fetch(apiUrl);
    if (!response.ok) throw new Error('Fetch failed');
    const data = await response.json();
    renderData(data);
  } catch (error) {
    console.error('Error:', error);
    renderError();
  }
}
```

## Polling Intervals

- Weather: 30 min
- Devices: 10 sec
- Notes: 30 sec
- Recipe: 1 hour
- Shipping: 5 min
- Notifications: 5 min (fallback, WebSocket is primary)

## File Structure

```
v2/
├── index.html    # Shell + SVG symbols + modals
├── style.css     # All styles, organized by component
├── app.js        # All logic
└── config.json   # Layout + API endpoints + devices
```

## Don'ts

- Don't hardcode colors - use CSS variables
- Don't add new CSS files - extend style.css
- Don't create separate JS modules - extend app.js sections
- Don't use `!important`
- Don't inline styles except for dynamic values (grid columns, bar widths)

## Code Hygiene

Clean up dead code while you're in there. Don't leave it till later. You'll forget and then we'll have technical debt.
