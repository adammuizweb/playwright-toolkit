# Playwright Toolkit — Browser Automation for AI Agents

A zero-config, multi-purpose browser automation toolkit designed for AI coding agents (opencode, Claude, Cursor, etc.). No hardcoded URLs, selectors, or credentials — everything is parameterized.

- **6 ready-to-use scripts** — screenshot, debug, OCR, multi-step flow testing
- **Uses system Chrome** — no browser download needed
- **Zero hardcoded config** — pass URL, credentials, selectors at runtime
- **Designed for AI** — predictable CLI, JSON-driven flows, error screenshots

## Setup

```bash
npm install
```

Requires **Node.js >= 18** and **Google Chrome/Chromium** installed on the system.

## Scripts

| Script | Purpose |
|--------|---------|
| `screenshot.mjs` | Take screenshot of a URL |
| `flow.mjs` | Run multi-step flow from JSON (testing, navigation, assertion) |
| `ocr-screenshot.mjs` | Screenshot + OCR pipeline |
| `debug.mjs` | Dump DOM, meta, console logs + screenshot |
| `device-screenshots.mjs` | Screenshots at 4 viewports (mobile/tablet/desktop/wide) |
| `connect-existing.mjs` | Connect to a running Chrome via CDP |
| `extract-cookies.mjs` | Extract cookies from Chrome profile to JSON file |

## Quick Start

```bash
# Screenshot a page
node screenshot.mjs https://example.com /tmp/screenshot.png

# Screenshot with login
node screenshot.mjs https://example.com/dashboard \
  /tmp/dashboard.png --login --email user@email.com --password pass

# Extract cookies from Chrome profile, then reuse without profile lock issues
node extract-cookies.mjs ~/.config/google-chrome /tmp/cookies.json
node screenshot.mjs https://example.com/dashboard \
  /tmp/dashboard.png --cookies /tmp/cookies.json

# Multi-step flow (see: Flow JSON format below)
node flow.mjs my-flow.json
node flow.mjs my-flow.json --var URL=https://example.com --var EMAIL=user@example.com

# Debug a page (HTTP status, meta tags, DOM, console)
node debug.mjs https://example.com

# OCR — screenshot + extract text via Tesseract
node ocr-screenshot.mjs https://example.com --lang eng

# All viewports at once
node device-screenshots.mjs https://example.com

# Connect to Chrome already running
node connect-existing.mjs http://localhost:3000 /tmp/page.png
```

## Flow Testing (`flow.mjs`)

Run multi-step browser flows defined in a JSON file. Supports login, navigation, clicks, assertions, and data extraction — all without writing a single line of JavaScript.

### Example flow.json

```json
{
  "name": "Dashboard smoke test",
  "steps": [
    { "action": "goto",             "url": "{URL}/login/" },
    { "action": "fill",             "selector": "input[name=\"email\"]",   "value": "{EMAIL}" },
    { "action": "fill",             "selector": "input[name=\"password\"]","value": "{PASSWORD}" },
    { "action": "click",            "selector": "button[type=\"submit\"]" },
    { "action": "waitSelector",     "selector": ".dashboard-stat", "timeout": 10000 },
    { "action": "assertText",       "selector": "h1", "contains": "Dashboard" },
    { "action": "screenshot",       "path": "/tmp/dashboard.png" }
  ]
}
```

Run with variables:

```bash
node flow.mjs flow.json --var URL=http://myapp.local --var EMAIL=admin@myapp.local --var PASSWORD=secret
```

### All actions

| Action | Description |
|--------|-------------|
| `goto` | Navigate to URL |
| `fill` | Type into input field |
| `click` | Click an element |
| `wait` | Wait N milliseconds |
| `waitSelector` | Wait for element to appear |
| `screenshot` | Save screenshot |
| `assertExists` | Assert element is in DOM |
| `assertText` | Assert element text contains string |
| `assertUrl` | Assert current URL contains string |
| `extractText` | Save element text to results |
| `extractHtml` | Save element HTML to results |
| `scrollTo` | Scroll element into view |
| `hover` | Hover over element |
| `selectOption` | Select dropdown option |
| `evaluate` | Run custom JS in page context |
| `keyPress` | Press a keyboard key |
| `reload` | Reload current page |
| `log` | Print message to stdout |

## Cookies — Extract & Reuse Sessions

The most reliable way to access authenticated pages: extract cookies from your Chrome profile once, then reuse them across runs.

### Step 1: Extract cookies

```bash
node extract-cookies.mjs ~/.config/google-chrome /tmp/cookies.json
```

This reads the Chrome profile's SQLite cookie database and saves Google/Gemini session cookies to a JSON file. Requires `sqlite3` CLI.

### Step 2: Use cookies in any script

```bash
node screenshot.mjs https://gemini.google.com /tmp/gemini.png --cookies /tmp/cookies.json
node flow.mjs my-flow.json --cookies /tmp/cookies.json
node debug.mjs https://mail.google.com --cookies /tmp/cookies.json
```

### How it works

The `extract-cookies.mjs` script opens the Chrome profile's `Cookies` SQLite database (read-only), filters relevant session cookies, and exports them as JSON. Other scripts load these cookies via `context.addCookies()` before navigating — no profile locking, no corruption risk.

**Re-extract cookies whenever your sessions expire** (after browser restart or logout).

Platform-specific profile locations:
- **Linux:** `~/.config/google-chrome` or `~/.config/chromium`
- **macOS:** `~/Library/Application Support/Google/Chrome`
- **Windows:** `%LOCALAPPDATA%\Google\Chrome\User Data`

## CDP — Connect to Running Chrome

When Chrome is already open (remote desktop, SSH, terminal), the profile is locked. Use Chrome DevTools Protocol (CDP) instead:

```bash
# 1. Start Chrome with remote debugging port
google-chrome --remote-debugging-port=9222 &

# 2. Connect from another terminal
node connect-existing.mjs http://localhost:3000 /tmp/screenshot.png
node connect-existing.mjs http://localhost:3000 --dump-html
```

This reuses the existing browser session — no login needed.

## Notes

- All scripts use `channel: 'chrome'` — requires Google Chrome or Chromium installed
- Pass `--headless false` to run headed (visible browser)
- Use `--no-sandbox` when running as root or in containers
- Use `--ignore-certificate-errors` for local dev sites with self-signed certs
- dbus stderr noise is harmless on Linux
- Screenshots are saved as PNG by default
