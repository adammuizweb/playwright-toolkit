#!/usr/bin/env node
/**
 * Generate image via AI with fallback chain:
 *   Gemini → Grok → ChatGPT → SVG fallback
 *
 * Connects to existing Chrome via CDP port 9222.
 * Detects text responses (errors, limits, trial messages) and switches provider.
 *
 * Usage:
 *   OUTPUT=/path/to/out.png node generate-image-ai.mjs "prompt"
 *
 * Env:
 *   CDP_PORT - default 9222
 *   OUTPUT   - output path
 *   PROMPT   - or pass as arg
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { execSync } from 'child_process';

const CDP_PORT = parseInt(process.env.CDP_PORT || '9222', 10);
const OUTPUT = resolve(process.env.OUTPUT || process.env.GEMINI_OUTPUT || '/var/www/tmp/thumbnail-src.png');
const PROMPT = process.argv[2] || process.env.PROMPT ||
  'Flat design professional illustration, no text, minimalist, clean background.';

mkdirSync(dirname(OUTPUT), { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getCDPBrowser() {
  console.log(`Connecting to Chrome on port ${CDP_PORT}...`);
  try {
    return await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  } catch {
    console.log('  CDP not available. Starting browser-session.service...');
    try {
      execSync('sudo systemctl start browser-session.service', { stdio: 'inherit' });
      console.log('  Waiting for Chrome to start...');
      for (let i = 0; i < 30; i++) {
        await sleep(1000);
        try {
          const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
          console.log('  Chrome CDP ready.');
          return browser;
        } catch {}
      }
    } catch (err) {
      console.error('  Failed to start browser-session.service:', err.message);
    }
    throw new Error(`Cannot connect to Chrome CDP on port ${CDP_PORT}`);
  }
}

async function getNewPage(browser) {
  const context = browser.contexts()[0];
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  return page;
}

async function dismissButtons(page, patterns) {
  const btns = await page.$$('button, [role="button"], a');
  for (const btn of btns) {
    try {
      const t = (await btn.textContent())?.trim() || '';
      if (t && patterns.some(p => p.test(t))) {
        console.log(`  Dismissing: "${t.slice(0, 60)}"`);
        await btn.click();
        await sleep(1500);
        return true;
      }
    } catch {}
  }
  return false;
}

async function extractPageText(page) {
  try {
    return await page.evaluate(() => {
      const clone = document.body.cloneNode(true);
      clone.querySelectorAll('script, style, noscript, nav, header, footer').forEach(el => el.remove());
      return clone.innerText || '';
    });
  } catch {
    return '';
  }
}

function detectFailure(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  const indicators = [
    'trial', 'tagihan', 'billing', 'cloud', 'google cloud', 'tidak dapat',
    'gagal', 'failed', 'limit', 'rate limit', 'unavailable', 'sedang sibuk',
    'busy', 'try again', 'coba lagi', 'error', 'unable', 'cannot',
    'not available', 'maaf', 'sorry', 'perbarui', 'upgrade', 'subscription'
  ];
  for (const ind of indicators) {
    if (lower.includes(ind)) return ind;
  }
  return null;
}

async function pollGeneratedImage(page, maxPolls = 40, pollInterval = 2500) {
  for (let i = 0; i < maxPolls; i++) {
    const result = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'))
        .filter(img => img.complete && img.naturalWidth >= 256)
        .filter(img => !img.src.includes('gstatic') && !img.src.includes('googleusercontent'));
      if (!imgs.length) return null;
      const img = imgs[0];
      return { src: img.src, naturalW: img.naturalWidth, naturalH: img.naturalHeight };
    });

    if (result) {
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
        } catch { return null; }
      });
      if (base64 && base64.length > 200) {
        const buf = Buffer.from(base64.split(',')[1], 'base64');
        return { ...result, buf };
      }
    }

    if (i % 4 === 0) {
      const text = await extractPageText(page);
      const fail = detectFailure(text);
      if (fail) {
        console.log(`  Detected failure indicator: "${fail}"`);
        return { failure: fail, text: text.slice(0, 500) };
      }
    }

    if (i % 5 === 0) console.log(`  Waiting... (poll ${i + 1}/${maxPolls})`);
    await sleep(pollInterval);
  }
  return null;
}

async function generateWithGemini(browser, prompt) {
  const page = await getNewPage(browser);
  try {
    console.log('\n[Provider: Gemini] Opening https://gemini.google.com/app');
    await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2000);

    await dismissButtons(page, [
      /get started/i, /try gemini/i, /agree/i, /lanjut/i, /continue/i,
      /accept/i, /got it/i, /mengerti/i, /mulai/i
    ]);

    let input = await page.$('div[contenteditable="true"]');
    if (!input) input = await page.$('[contenteditable]');
    if (!input) {
      console.log('  No input found, taking screenshot...');
      await page.screenshot({ path: OUTPUT.replace('.png', '-gemini-no-input.png') });
      return { ok: false, reason: 'no-input' };
    }

    await input.click();
    await page.keyboard.type(prompt, { delay: 5 });
    await sleep(500);

    const sendBtn = await page.$('button[aria-label*="Send"], button[aria-label*="send"], button[aria-label*="Kirim"]');
    if (sendBtn && await sendBtn.isVisible()) await sendBtn.click();
    else await page.keyboard.press('Enter');

    console.log('  Prompt sent. Polling for generated image...');
    const result = await pollGeneratedImage(page, 40, 2500);

    if (result && result.buf) {
      writeFileSync(OUTPUT, result.buf);
      console.log(`  Saved ${result.naturalW}x${result.naturalH} (${result.buf.length} bytes)`);
      return { ok: true };
    }

    if (result && result.failure) {
      return { ok: false, reason: 'failure-indicator', detail: result.text };
    }

    const text = await extractPageText(page);
    await page.screenshot({ path: OUTPUT.replace('.png', '-gemini-final.png') });
    return { ok: false, reason: 'no-image', detail: text.slice(0, 500) };
  } finally {
    await page.close().catch(() => {});
  }
}

async function generateWithGrok(browser, prompt) {
  const page = await getNewPage(browser);
  try {
    console.log('\n[Provider: Grok] Opening https://grok.com/');
    await page.goto('https://grok.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    await dismissButtons(page, [
      /get started/i, /try grok/i, /agree/i, /continue/i, /accept/i,
      /got it/i, /dismiss/i, /not now/i, /maybe later/i
    ]);

    // Try common input selectors
    const inputSelectors = [
      'textarea[placeholder*="Ask"], textarea[placeholder*="ask"], textarea[placeholder*="Grok"], textarea[placeholder*="grok"]',
      'textarea[contenteditable]',
      'div[contenteditable="true"]',
      'textarea'
    ];

    let input = null;
    for (const sel of inputSelectors) {
      input = await page.$(sel);
      if (input) break;
    }

    if (!input) {
      console.log('  No input found, taking screenshot...');
      await page.screenshot({ path: OUTPUT.replace('.png', '-grok-no-input.png') });
      return { ok: false, reason: 'no-input' };
    }

    await input.click();
    await input.fill(prompt);
    await sleep(500);

    // Press Enter or find send button
    const sendBtn = await page.$('button[type="submit"], button[aria-label*="Send"], button svg[viewBox]');
    if (sendBtn && await sendBtn.isVisible()) await sendBtn.click();
    else await page.keyboard.press('Enter');

    console.log('  Prompt sent. Polling for generated image...');
    const result = await pollGeneratedImage(page, 40, 2500);

    if (result && result.buf) {
      writeFileSync(OUTPUT, result.buf);
      console.log(`  Saved ${result.naturalW}x${result.naturalH} (${result.buf.length} bytes)`);
      return { ok: true };
    }

    if (result && result.failure) {
      return { ok: false, reason: 'failure-indicator', detail: result.text };
    }

    const text = await extractPageText(page);
    await page.screenshot({ path: OUTPUT.replace('.png', '-grok-final.png') });
    return { ok: false, reason: 'no-image', detail: text.slice(0, 500) };
  } finally {
    await page.close().catch(() => {});
  }
}

async function generateWithChatGPT(browser, prompt) {
  const page = await getNewPage(browser);
  try {
    console.log('\n[Provider: ChatGPT] Opening https://chatgpt.com/');
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    await dismissButtons(page, [
      /get started/i, /try chatgpt/i, /agree/i, /continue/i, /accept/i,
      /got it/i, /dismiss/i, /not now/i, /log in/i, /sign in/i
    ]);

    const inputSelectors = [
      'div[contenteditable="true"]',
      'textarea[placeholder*="Message"], textarea[placeholder*="message"], textarea[placeholder*="ChatGPT"]',
      'textarea'
    ];

    let input = null;
    for (const sel of inputSelectors) {
      input = await page.$(sel);
      if (input) break;
    }

    if (!input) {
      console.log('  No input found, taking screenshot...');
      await page.screenshot({ path: OUTPUT.replace('.png', '-chatgpt-no-input.png') });
      return { ok: false, reason: 'no-input' };
    }

    await input.click();
    await input.fill(prompt);
    await sleep(500);

    const sendBtn = await page.$('button[data-testid*="send"], button[aria-label*="Send"], button[type="submit"]');
    if (sendBtn && await sendBtn.isVisible()) await sendBtn.click();
    else await page.keyboard.press('Enter');

    console.log('  Prompt sent. Polling for generated image...');
    const result = await pollGeneratedImage(page, 40, 2500);

    if (result && result.buf) {
      writeFileSync(OUTPUT, result.buf);
      console.log(`  Saved ${result.naturalW}x${result.naturalH} (${result.buf.length} bytes)`);
      return { ok: true };
    }

    if (result && result.failure) {
      return { ok: false, reason: 'failure-indicator', detail: result.text };
    }

    const text = await extractPageText(page);
    await page.screenshot({ path: OUTPUT.replace('.png', '-chatgpt-final.png') });
    return { ok: false, reason: 'no-image', detail: text.slice(0, 500) };
  } finally {
    await page.close().catch(() => {});
  }
}

async function main() {
  let browser;
  try {
    browser = await getCDPBrowser();
  } catch (err) {
    console.error('Fatal: Cannot connect to Chrome CDP:', err.message);
    console.error('Make sure b.lan / browser-session.service is running.');
    process.exit(2);
  }

  let lastError = null;

  const gemini = await generateWithGemini(browser, PROMPT);
  if (gemini.ok) {
    console.log('\n✅ Gemini succeeded.');
    await browser.close().catch(() => {});
    process.exit(0);
  }
  lastError = gemini;
  console.log(`  Gemini failed: ${gemini.reason}${gemini.detail ? ' — ' + gemini.detail : ''}`);

  const grok = await generateWithGrok(browser, PROMPT);
  if (grok.ok) {
    console.log('\n✅ Grok succeeded.');
    await browser.close().catch(() => {});
    process.exit(0);
  }
  lastError = grok;
  console.log(`  Grok failed: ${grok.reason}${grok.detail ? ' — ' + grok.detail : ''}`);

  const chatgpt = await generateWithChatGPT(browser, PROMPT);
  if (chatgpt.ok) {
    console.log('\n✅ ChatGPT succeeded.');
    await browser.close().catch(() => {});
    process.exit(0);
  }
  lastError = chatgpt;
  console.log(`  ChatGPT failed: ${chatgpt.reason}${chatgpt.detail ? ' — ' + chatgpt.detail : ''}`);

  await browser.close().catch(() => {});
  console.error('\n❌ All providers failed. Last error:', lastError);
  process.exit(1);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
