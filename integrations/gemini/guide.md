# Gemini Imagen — Image Generation via Browser Automation

> **⚠️ CATATAN:** Akses Imagen tergantung akun Google — beberapa akun punya (termasuk akun ini), beberapa tidak. Jika Gemini membalas teks bukan gambar, berarti akun tidak punya akses Imagen. Fallback: SVG ilustrasi manual via `rsvg-convert` (lihat `gambar.md`).

## Why This Guide Exists

AI agents (like opencode) lose context between sessions. This guide encodes all the hard-won knowledge about generating images via Google Gemini/Imagen automatically, so **any AI in a fresh session** can do it without trial and error.

---

## The Problem

Generating AI images via `gemini.google.com` programmatically requires:

1. A Chrome session logged into Google
2. Navigating to Gemini, typing a prompt, clicking send
3. Waiting for Imagen to render the image
4. Extracting the generated image

**Three things make this non-trivial:**

| Issue | Why | Workaround |
|-------|-----|------------|
| Chrome v149 blocks `--remote-debugging-port` on default profile | Chrome refuses debug port when `--user-data-dir` points to the running default profile | Copy profile to `/tmp/chrome-profile-tmp/` |
| Chrome `--headless` doesn't render Imagen UI | Gemini's image generation panel/canvas doesn't initialize in headless mode | Use Xvfb virtual display + Chrome *headed* |
| Chrome extensions intercept `window.fetch()` blocking blob URL extraction | Extensions like "Violentmonkey" override `fetch()` — `canvas.toDataURL()` bypasses | Extract via `canvas.drawImage()` + `toDataURL()` |

---

## Complete Workflow

### Step 1: Kill old Chrome + clean

```bash
pkill -9 -f chrome 2>/dev/null
sleep 2
rm -rf /tmp/chrome-profile-tmp
```

### Step 2: Copy Chrome profile to temp dir

```bash
mkdir -p /tmp/chrome-profile-tmp
cp -a /home/adam/.config/google-chrome/Local\ State /tmp/chrome-profile-tmp/
cp -a /home/adam/.config/google-chrome/Default /tmp/chrome-profile-tmp/Default
rm -f /tmp/chrome-profile-tmp/Singleton*
```

This copy gives us a snapshot of the profile that Chrome can freely use with `--remote-debugging-port`. The original profile stays untouched.

### Step 3: Start Xvfb (virtual display)

```bash
Xvfb :99 -screen 0 1920x1080x24 -ac > /dev/null 2>&1 &
```

Xvfb provides a virtual display that Chrome treats as a real monitor. Without this, Chrome headless mode (`--headless`) would be used — which **cannot render Imagen's image generation UI**.

**Why headless fails:** Imagen's generated image display uses canvas/WebGL rendering that only works when Chrome thinks it has a real display. `--headless` mode loads the page but the "Generate" button or image output area never appears.

### Step 4: Launch Chrome (headed) with CDP

```bash
export DISPLAY=:99
setsid /opt/google/chrome/chrome --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-profile-tmp --no-first-run \
  --no-sandbox --disable-gpu --disable-software-rasterizer \
  about:blank > /tmp/chrome-cdp.log 2>&1 & disown
sleep 8
```

Key flags:
- **No `--headless`** — this is critical. Chrome must run *headed* via Xvfb.
- `--remote-debugging-port=9222` — enables CDP connection
- `--user-data-dir=/tmp/chrome-profile-tmp` — uses the copied profile (logged into Google)
- `--no-sandbox` — required when running as non-root
- `setsid` + `disown` — fully detaches Chrome from shell session; survives tool timeout
- `--disable-gpu --disable-software-rasterizer` — prevents GPU crash in headless server

### Step 5 (Diagnostic): Cek apakah Imagen tersedia

Sebelum generate, pastikan akun punya Imagen dengan buka Gemini manual:

```bash
# Screenshot halaman Gemini setelah load
node -e "
import { chromium } from 'playwright';
const b = await chromium.connectOverCDP('http://127.0.0.1:9222');
const p = b.contexts()[0].pages()[0];
await p.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded', timeout: 30000 });
await p.waitForTimeout(5000);
const t = await p.evaluate(() => document.body.innerText.slice(0, 1000));
console.log(t.replace(/\\n/g, ' | '));
await p.screenshot({ path: '/tmp/gemini-diagnostic.png' });
await b.close();
"
```

Cari teks seperti **"Generate image"**, **"Buat gambar"**, atau ikon image di UI.  
Jika hanya ada input teks biasa tanpa opsi generate gambar → akun **tidak punya Imagen**.  
Gunakan metode SVG fallback (lihat `gambar.md`).

### Step 6: Generate image

```bash
cd /var/www/playwright
node integrations/gemini/generate-image.mjs \
  "Gambarkan ilustrasi vektor modern seekor burung hantu, tema gelap, aksen neon hijau"
```

The script will:
1. Connect to Chrome via CDP at `127.0.0.1:9222`
2. Open `gemini.google.com/app`
3. Wait for the input field (`div[contenteditable="true"]`)
4. Dismiss any consent dialogs
5. Type the prompt and press Send
6. Poll DOM every 2.5s for generated images (up to 40 polls = ~100s)
7. Extract the image via **canvas API** (bypasses extension fetch interception)
8. Save as PNG to output path

### Step 7: Clean up

```bash
# Kill Chrome (keep Xvfb running for next use)
curl -s http://127.0.0.1:9222/json/close 2>/dev/null
pkill -f "chrome.*remote-debugging-port" 2>/dev/null
rm -rf /tmp/chrome-profile-tmp
```

---

## Why Canvas API for Image Extraction

Chrome extensions (especially user script managers like Violentmonkey, Tampermonkey) can override `window.fetch()` in page context. When the script tries `fetch(img.src)` to get the generated image's blob, the extension intercepts the call.

**The fix:** `canvas.drawImage()` + `canvas.toDataURL('image/png')` — extensions cannot intercept canvas operations. This gives us the raw image data at full resolution (1024×1024 for Imagen).

The script does this in the page context:
```js
const c = document.createElement('canvas');
c.width = img.naturalWidth;
c.height = img.naturalHeight;
c.getContext('2d').drawImage(img, 0, 0);
return c.toDataURL('image/png');
```

---

## Output

| Variable | Default | Set via |
|----------|---------|---------|
| `OUTPUT` | `./output/gemini-generated.png` | env var or `.env` |
| `GEMINI_OUTPUT` | (fallback) | `.env` file |
| Actual path | `/var/www/tmp/download/gemini-generated.png` | from `.env` config |

Resolution: **1024×1024** PNG.

---

## Common Pitfalls

| Symptom | Cause | Fix |
|---------|-------|-----|
| `connect ECONNREFUSED 127.0.0.1:9222` | Chrome crashed or not started yet | Check `DISPLAY=:99` is set, Xvfb is running, wait 6s after launch |
| Page shows "plus" and "mic" only | Headless mode — Imagen UI didn't render | Use Xvfb + headed, NOT `--headless` |
| `No input element found` | Dialog/redirect / not logged in | Verify profile has Google session; check `/tmp/gemini-fail.png` screenshot |
| `No generated image found` after 40 polls | Prompt too complex / Imagen error / timeout | Check `/tmp/gemini-final.png` screenshot; try simpler prompt |
| Gemini membalas teks (bukan gambar) | Akun tidak punya Imagen (Gemini Pro only) | Cek `/tmp/gemini-diagnostic.png`; fallback ke SVG (`gambar.md`) |
| Image is 0 bytes or corrupt | Canvas extraction failed | Check if Chrome extensions blocked canvas; run without extensions if possible |
| Chrome won't start with `--remote-debugging-port` | SingletonLock from previous crash | Delete `/tmp/chrome-profile-tmp/Singleton*` and re-copy profile |

---

## Script Location

```
/var/www/playwright/
├── integrations/gemini/
│   ├── generate-image.mjs   # Main script
│   └── guide.md              # This file
├── scripts/                  # Other Playwright helpers
├── .env                      # Env config (gitignored)
└── package.json
```

---

## Quick One-Liner (After Setup)

Once Chrome is running with CDP on port 9222:

```bash
node /var/www/playwright/integrations/gemini/generate-image.mjs "your prompt here"
```

Output goes to path specified by `OUTPUT` or `GEMINI_OUTPUT` env var (default: `./output/gemini-generated.png`).

## Fallback: SVG Illustration

Jika akun tidak punya Imagen, buat ilustrasi via SVG manual:

```bash
# Bikin SVG sederhana
cat > /tmp/illustration.svg << 'SVG'
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450">
  <rect width="800" height="450" fill="#1a1a2e"/>
  <circle cx="400" cy="225" r="100" fill="none" stroke="#00ff88" stroke-width="2"/>
</svg>
SVG

# Convert ke PNG
rsvg-convert -w 800 -h 450 /tmp/illustration.svg -o /tmp/illustration.png
```

Lihat `gambar.md` untuk panduan lengkap desain SVG.
