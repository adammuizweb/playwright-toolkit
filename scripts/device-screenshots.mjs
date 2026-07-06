#!/usr/bin/env node
/**
 * Take screenshots at multiple viewport sizes (mobile, tablet, desktop).
 * Usage:
 *   node device-screenshots.mjs <url> [--profile ~/.config/google-chrome]
 *   node device-screenshots.mjs <url> --login --email <email> --password <pass>
 */

import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'fs';

const [,, url] = process.argv;
const args = process.argv.slice(3);

const DEVICES = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 720 },
  { name: 'wide', width: 1920, height: 1080 },
];

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
  console.error('Usage: node device-screenshots.mjs <url> [options]');
  process.exit(1);
}

(async () => {
  const baseArgs = ['--no-sandbox', '--disable-gpu', '--ignore-certificate-errors'];

  if (opts.profile) {
    // With profile, use persistent context (single viewport)
    const context = await chromium.launchPersistentContext(opts.profile, {
      channel: 'chrome',
      args: baseArgs,
      viewport: { width: 1280, height: 720 },
      ignoreHTTPSErrors: true,
    });
    const pages = context.pages();
    const page = pages.length > 0 ? pages[0] : await context.newPage();

    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

    if (opts.login) {
      if (opts.email) await page.fill('input[type="email"], input[name="email"]', opts.email);
      if (opts.password) await page.fill('input[type="password"], input[name="password"]', opts.password);
      await page.click('button[type="submit"]');
      await page.waitForTimeout(2000);
    }

    for (const device of DEVICES) {
      console.log(`\n--- ${device.name} (${device.width}x${device.height}) ---`);
      await page.setViewportSize({ width: device.width, height: device.height });
      await page.waitForTimeout(500);
      const outPath = `/tmp/screenshot-${device.name}.png`;
      await page.screenshot({ path: outPath, fullPage: true });
      console.log(`  Saved: ${outPath}`);
    }

    await context.close();
  } else {
    const browser = await chromium.launch({ channel: 'chrome', args: baseArgs });

    for (const device of DEVICES) {
      console.log(`\n--- ${device.name} (${device.width}x${device.height}) ---`);
      const context = await browser.newContext({
        viewport: { width: device.width, height: device.height },
        ignoreHTTPSErrors: true,
      });
      if (opts.cookies && existsSync(opts.cookies)) {
        const cookies = JSON.parse(readFileSync(opts.cookies, 'utf-8'));
        await context.addCookies(cookies);
        console.log(`Loaded ${cookies.length} cookies`);
      }
      const page = await context.newPage();

      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

        if (opts.login) {
          if (opts.email) await page.fill('input[type="email"], input[name="email"]', opts.email);
          if (opts.password) await page.fill('input[type="password"], input[name="password"]', opts.password);
          await page.click('button[type="submit"]');
          await page.waitForTimeout(2000);
        }

        const outPath = `/tmp/screenshot-${device.name}.png`;
        await page.screenshot({ path: outPath, fullPage: true });
        console.log(`  Saved: ${outPath}`);
      } catch (err) {
        console.error(`  Error: ${err.message}`);
      } finally {
        await context.close();
      }
    }

    await browser.close();
  }

  console.log('\nDone.');
})();
