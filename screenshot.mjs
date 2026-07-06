#!/usr/bin/env node
/**
 * Take browser screenshot using system Chrome.
 * Usage:
 *   node screenshot.mjs <url> [output.png] [--viewport 1280,720] [--full] [--mobile]
 *
 *   With login:
 *   node screenshot.mjs <url> [output.png] --login --email <email> --password <pass> --submit-btn <selector>
 *
 *   With existing Chrome profile (already authenticated):
 *   node screenshot.mjs <url> [output.png] --profile ~/.config/google-chrome
 *
 *   With cookies extracted from profile:
 *   node screenshot.mjs <url> [output.png] --cookies /tmp/cookies.json
 */

import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'fs';

const [,, url, output] = process.argv;
const args = process.argv.slice(3);

const opts = {
  output: output || '/tmp/screenshot.png',
  viewport: { width: 1280, height: 720 },
  fullPage: false,
  login: false,
  email: '',
  password: '',
  submitSelector: 'button[type="submit"]',
  profile: null,
  cookies: null,
};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--viewport' && args[i+1]) {
    const [w, h] = args[++i].split(',').map(Number);
    opts.viewport = { width: w || 1280, height: h || 720 };
  }
  if (args[i] === '--full') opts.fullPage = true;
  if (args[i] === '--mobile') opts.viewport = { width: 375, height: 812 };
  if (args[i] === '--login') opts.login = true;
  if (args[i] === '--email' && args[i+1]) opts.email = args[++i];
  if (args[i] === '--password' && args[i+1]) opts.password = args[++i];
  if (args[i] === '--submit-btn' && args[i+1]) opts.submitSelector = args[++i];
  if (args[i] === '--profile' && args[i+1]) opts.profile = args[++i];
  if (args[i] === '--cookies' && args[i+1]) opts.cookies = args[++i];
}

if (!url) {
  console.error('Usage: node screenshot.mjs <url> [output.png] [options]');
  console.error('Options:');
  console.error('  --viewport W,H     Viewport size (default: 1280,720)');
  console.error('  --full             Full page screenshot');
  console.error('  --mobile           Mobile viewport (375x812)');
  console.error('  --login            Login before screenshot');
  console.error('  --email <email>    Login email');
  console.error('  --password <pass>  Login password');
  console.error('  --submit-btn <sel> Login button selector');
  console.error('  --profile <dir>    Use existing Chrome profile (authenticated)');
  process.exit(1);
}

(async () => {
  const baseArgs = ['--no-sandbox', '--disable-gpu', '--ignore-certificate-errors'];

  if (opts.profile) {
    const context = await chromium.launchPersistentContext(opts.profile, {
      channel: 'chrome',
      args: baseArgs,
      viewport: opts.viewport,
      ignoreHTTPSErrors: true,
    });

    const pages = context.pages();
    const page = pages.length > 0 ? pages[0] : await context.newPage();

    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

      if (opts.login) {
        if (opts.email) await page.fill('input[type="email"], input[name="email"]', opts.email);
        if (opts.password) await page.fill('input[type="password"], input[name="password"]', opts.password);
        await page.click(opts.submitSelector);
        await page.waitForTimeout(2000);
      }

      await page.screenshot({ path: opts.output, fullPage: opts.fullPage });
      console.log(`Screenshot saved: ${opts.output}`);
    } catch (err) {
      console.error('Error:', err.message);
      try {
        await page.screenshot({ path: '/tmp/screenshot-error.png' });
        console.error('Error screenshot saved: /tmp/screenshot-error.png');
      } catch {}
    } finally {
      await context.close();
    }
  } else {
    const browser = await chromium.launch({
      channel: 'chrome',
      args: baseArgs,
    });
    const context = await browser.newContext({ viewport: opts.viewport, ignoreHTTPSErrors: true });

    // Load cookies if provided
    if (opts.cookies) {
      if (existsSync(opts.cookies)) {
        const cookies = JSON.parse(readFileSync(opts.cookies, 'utf-8'));
        await context.addCookies(cookies);
        console.log(`Loaded ${cookies.length} cookies from ${opts.cookies}`);
      } else {
        console.warn(`Cookies file not found: ${opts.cookies}`);
      }
    }

    const page = await context.newPage();

    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

      if (opts.login) {
        if (opts.email) await page.fill('input[type="email"], input[name="email"]', opts.email);
        if (opts.password) await page.fill('input[type="password"], input[name="password"]', opts.password);
        await page.click(opts.submitSelector);
        await page.waitForTimeout(2000);
      }

      await page.screenshot({ path: opts.output, fullPage: opts.fullPage });
      console.log(`Screenshot saved: ${opts.output}`);
    } catch (err) {
      console.error('Error:', err.message);
      try {
        await page.screenshot({ path: '/tmp/screenshot-error.png' });
        console.error('Error screenshot saved: /tmp/screenshot-error.png');
      } catch {}
    } finally {
      await browser.close();
    }
  }
})();
