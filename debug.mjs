#!/usr/bin/env node
/**
 * Debug a web page: dump DOM, meta tags, console logs, and screenshot.
 * Usage:
 *   node debug.mjs <url> [--profile ~/.config/google-chrome]
 *   node debug.mjs <url> --login --email <email> --password <pass>
 */

import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'fs';

const [,, url] = process.argv;
const args = process.argv.slice(3);

const opts = {
  login: false,
  email: '',
  password: '',
  profile: null,
  cookies: null,
};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--login') opts.login = true;
  if (args[i] === '--email' && args[i+1]) opts.email = args[++i];
  if (args[i] === '--password' && args[i+1]) opts.password = args[++i];
  if (args[i] === '--profile' && args[i+1]) opts.profile = args[++i];
  if (args[i] === '--cookies' && args[i+1]) opts.cookies = args[++i];
}

if (!url) {
  console.error('Usage: node debug.mjs <url> [options]');
  process.exit(1);
}

(async () => {
  const baseArgs = ['--no-sandbox', '--disable-gpu', '--ignore-certificate-errors'];
  const consoleLogs = [];
  let closeTarget = null;

  if (opts.profile) {
    const context = await chromium.launchPersistentContext(opts.profile, {
      channel: 'chrome',
      args: baseArgs,
      viewport: { width: 1280, height: 720 },
      ignoreHTTPSErrors: true,
    });
    const pages = context.pages();
    const page = pages.length > 0 ? pages[0] : await context.newPage();
    closeTarget = context;

    page.on('console', msg => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
    page.on('pageerror', err => consoleLogs.push(`[PAGE ERROR] ${err.message}`));

    await runDebug(page);
    await closeTarget.close();
  } else {
    const browser = await chromium.launch({ channel: 'chrome', args: baseArgs });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true });
    if (opts.cookies && existsSync(opts.cookies)) {
      const cookies = JSON.parse(readFileSync(opts.cookies, 'utf-8'));
      await context.addCookies(cookies);
      console.log(`Loaded ${cookies.length} cookies`);
    }
    const page = await context.newPage();
    closeTarget = browser;

    page.on('console', msg => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
    page.on('pageerror', err => consoleLogs.push(`[PAGE ERROR] ${err.message}`));

    await runDebug(page);
    await closeTarget.close();
  }

  async function runDebug(page) {
    try {
      const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

      if (opts.login) {
        if (opts.email) await page.fill('input[type="email"], input[name="email"]', opts.email);
        if (opts.password) await page.fill('input[type="password"], input[name="password"]', opts.password);
        await page.click('button[type="submit"]');
        await page.waitForTimeout(2000);
      }

      console.log(`\n=== HTTP Response ===`);
      console.log(`URL: ${resp.url()}`);
      console.log(`Status: ${resp.status()}`);
      console.log(`Headers:`);
      for (const [k, v] of Object.entries(resp.headers())) {
        if (!['set-cookie', 'authorization'].includes(k.toLowerCase())) {
          console.log(`  ${k}: ${v}`);
        }
      }

      console.log(`\n=== Meta Tags ===`);
      const meta = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('meta')).map(m => ({
          name: m.getAttribute('name') || m.getAttribute('property') || '',
          content: m.getAttribute('content') || '',
        })).filter(m => m.name);
      });
      meta.forEach(m => console.log(`  ${m.name}: ${m.content}`));

      console.log(`\n=== Title ===`);
      console.log(`  ${await page.title()}`);

      console.log(`\n=== Visible Text (first 50 lines) ===`);
      const text = await page.evaluate(() => document.body.innerText);
      const lines = text.split('\n').filter(l => l.trim()).slice(0, 50);
      lines.forEach(l => console.log(`  ${l}`));

      if (consoleLogs.length > 0) {
        console.log(`\n=== Console Logs (${consoleLogs.length}) ===`);
        consoleLogs.slice(0, 20).forEach(l => console.log(`  ${l}`));
      }

      await page.screenshot({ path: '/tmp/debug-screenshot.png' });
      console.log(`\nScreenshot: /tmp/debug-screenshot.png`);

    } catch (err) {
      console.error('Error:', err.message);
      try {
        await page.screenshot({ path: '/tmp/debug-error.png' });
        console.error('Error screenshot: /tmp/debug-error.png');
      } catch {}
    }
  }
})();
