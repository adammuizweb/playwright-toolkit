#!/usr/bin/env node
/**
 * Debug a web page: dump DOM, meta tags, console logs, and screenshot.
 * Usage:
 *   node debug.mjs <url> [--profile ~/.config/google-chrome]
 *   node debug.mjs <url> --login --email <email> --password <pass>
 */

import { chromium } from 'playwright';

const [,, url] = process.argv;
const args = process.argv.slice(3);

const opts = {
  login: false,
  email: '',
  password: '',
  profile: null,
};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--login') opts.login = true;
  if (args[i] === '--email' && args[i+1]) opts.email = args[++i];
  if (args[i] === '--password' && args[i+1]) opts.password = args[++i];
  if (args[i] === '--profile' && args[i+1]) opts.profile = args[++i];
}

if (!url) {
  console.error('Usage: node debug.mjs <url> [options]');
  process.exit(1);
}

(async () => {
  const launchOpts = {
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-gpu', '--ignore-certificate-errors'],
  };
  if (opts.profile) {
    launchOpts.args.push(`--user-data-dir=${opts.profile}`);
  }

  const browser = await chromium.launch(launchOpts);
  const context = opts.profile
    ? await browser.newContext({ ignoreHTTPSErrors: true })
    : await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();

  const consoleLogs = [];
  page.on('console', msg => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => consoleLogs.push(`[PAGE ERROR] ${err.message}`));

  try {
    const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

    if (opts.login) {
      if (opts.email) await page.fill('input[type="email"], input[name="email"]', opts.email);
      if (opts.password) await page.fill('input[type="password"], input[name="password"]', opts.password);
      await page.click('button[type="submit"]');
      await page.waitForTimeout(2000);
    }

    // HTTP info
    console.log(`\n=== HTTP Response ===`);
    console.log(`URL: ${resp.url()}`);
    console.log(`Status: ${resp.status()}`);
    console.log(`Headers:`);
    for (const [k, v] of Object.entries(resp.headers())) {
      if (!['set-cookie', 'authorization'].includes(k.toLowerCase())) {
        console.log(`  ${k}: ${v}`);
      }
    }

    // Meta tags
    console.log(`\n=== Meta Tags ===`);
    const meta = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('meta')).map(m => ({
        name: m.getAttribute('name') || m.getAttribute('property') || '',
        content: m.getAttribute('content') || '',
      })).filter(m => m.name);
    });
    meta.forEach(m => console.log(`  ${m.name}: ${m.content}`));

    // Title
    console.log(`\n=== Title ===`);
    console.log(`  ${await page.title()}`);

    // Visible text (first 50 lines)
    console.log(`\n=== Visible Text (first 50 lines) ===`);
    const text = await page.evaluate(() => document.body.innerText);
    const lines = text.split('\n').filter(l => l.trim()).slice(0, 50);
    lines.forEach(l => console.log(`  ${l}`));

    // Console logs
    if (consoleLogs.length > 0) {
      console.log(`\n=== Console Logs (${consoleLogs.length}) ===`);
      consoleLogs.slice(0, 20).forEach(l => console.log(`  ${l}`));
    }

    // Screenshot
    await page.screenshot({ path: '/tmp/debug-screenshot.png' });
    console.log(`\nScreenshot: /tmp/debug-screenshot.png`);

  } catch (err) {
    console.error('Error:', err.message);
    try {
      await page.screenshot({ path: '/tmp/debug-error.png' });
      console.error('Error screenshot: /tmp/debug-error.png');
    } catch {}
  } finally {
    await browser.close();
  }
})();
