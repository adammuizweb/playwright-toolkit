#!/usr/bin/env node
/**
 * Generate an image using Google Gemini (Imagen) via browser automation.
 *
 * Requires:
 *   - Chrome running with --remote-debugging-port=9222 (or set CDP_PORT)
 *   - A Chrome profile logged into Google (for Gemini access)
 *
 * Usage:
 *   node generate-gemini-image.mjs [prompt]
 *
 * Environment variables:
 *   CDP_PORT      - Chrome DevTools Protocol port (default: 9222)
 *   OUTPUT        - Output file path (default: ./output/gemini-generated.png)
 *   CHROME_PROFILE - Chrome user data dir for launching (if not already running)
 *   PROMPT        - Image generation prompt (or pass as first argument)
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';

const CDP_PORT = parseInt(process.env.CDP_PORT || '9222', 10);
const OUTPUT = resolve(process.env.OUTPUT || process.env.GEMINI_OUTPUT || './output/gemini-generated.png');
const PROMPT = process.argv[2] || process.env.PROMPT ||
  'Gambarkan ilustrasi vektor modern tema gelap dengan aksen hijau ' +
  'tentang browser automation — robot asisten AI mengendalikan beberapa browser. ' +
  'Gaya flat design profesional, resolusi 1024x1024. JANGAN pakai teks.';

// Ensure output directory exists
const outDir = dirname(OUTPUT);
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

async function main() {
  console.log(`Connecting to Chrome on port ${CDP_PORT}...`);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  const context = browser.contexts()[0];
  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(30000);

  console.log('Opening Gemini...');
  await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Wait for input to appear
  try {
    await page.waitForSelector('div[contenteditable="true"]', { timeout: 15000 });
  } catch {
    await page.waitForTimeout(8000);
  }

  // Handle dialogs (terms, get started, etc.)
  const btns = await page.$$('button:not([aria-hidden])');
  for (const btn of btns) {
    const t = (await btn.textContent())?.trim();
    if (t && /(get started|try gemini|agree|lanjut|continue|accept|got it)/i.test(t)) {
      console.log(`  Dismissing: "${t.slice(0, 40)}"`);
      await btn.click();
      await page.waitForTimeout(2000);
      break;
    }
  }

  // Find input element
  let input = await page.$('div[contenteditable="true"]');
  if (!input) input = await page.$('[contenteditable]');
  if (!input) {
    console.error('No input element found on Gemini page.');
    await page.screenshot({ path: '/tmp/gemini-fail.png' });
    await browser.close();
    process.exit(1);
  }

  console.log('Sending prompt to Gemini...');
  await input.click();
  await page.keyboard.type(PROMPT, { delay: 10 });
  await page.waitForTimeout(500);

  const sendBtn = await page.$(
    'button[aria-label*="Send"], button[aria-label*="send"], button[aria-label*="Kirim"]'
  );
  if (sendBtn && await sendBtn.isVisible()) {
    await sendBtn.click();
  } else {
    await page.keyboard.press('Enter');
  }
  console.log('Prompt sent. Waiting for image generation...');

  // Poll for generated image
  let found = false;
  for (let i = 0; i < 40; i++) {
    const result = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'))
        .filter(img => img.complete && img.naturalWidth >= 256)
        .filter(img => !img.src.includes('gstatic') && !img.src.includes('googleusercontent'));
      if (imgs.length === 0) return null;
      const img = imgs[0];
      return {
        src: img.src,
        naturalW: img.naturalWidth,
        naturalH: img.naturalHeight,
      };
    });

    if (result) {
      console.log(`Image detected: ${result.naturalW}x${result.naturalH}`);

      // Get raw image data via canvas (bypasses Chrome extension fetch interceptors)
      const base64 = await page.evaluate(() => {
        const img = Array.from(document.querySelectorAll('img'))
          .filter(i => i.complete && i.naturalWidth >= 256)
          .filter(i => !i.src.includes('gstatic') && !i.src.includes('googleusercontent'))[0];
        if (!img) return null;
        try {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          c.getContext('2d').drawImage(img, 0, 0);
          return c.toDataURL('image/png');
        } catch {
          return null;
        }
      });

      if (base64 && base64.length > 200) {
        const buf = Buffer.from(base64.split(',')[1], 'base64');
        writeFileSync(OUTPUT, buf);
        console.log(`Saved: ${OUTPUT} (${buf.length} bytes, ${result.naturalW}x${result.naturalH})`);
        found = true;
      }
      break;
    }

    if (i % 5 === 0) console.log(`  Waiting... (poll ${i + 1}/40)`);
    await page.waitForTimeout(2500);
  }

  if (!found) {
    console.error('No generated image found.');
    await page.screenshot({ path: '/tmp/gemini-final.png' });
  }

  await browser.close();
  console.log('Done.');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
