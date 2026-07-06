#!/usr/bin/env node
/**
 * Connect to an ALREADY RUNNING Chrome instance via CDP.
 * Use this when Chrome is already open (remote desktop, terminal, etc.).
 *
 * Prerequisite: Chrome must be started with --remote-debugging-port=9222
 *
 * Usage:
 *   node connect-existing.mjs <url> [output.png]
 *   node connect-existing.mjs <url> --dump-html
 *   node connect-existing.mjs <url> --wait 3000
 */

import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const [,, url, output] = process.argv;
const args = process.argv.slice(3);

const opts = {
  output: output || '/tmp/cdp-screenshot.png',
  dumpHtml: false,
  wait: 0,
  port: 9222,
};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dump-html') opts.dumpHtml = true;
  if (args[i] === '--wait' && args[i+1]) opts.wait = parseInt(args[++i]) || 0;
  if (args[i] === '--port' && args[i+1]) opts.port = parseInt(args[++i]) || 9222;
}

if (!url) {
  console.error('Usage: node connect-existing.mjs <url> [output.png] [options]');
  console.error('Requires Chrome running with --remote-debugging-port=9222');
  process.exit(1);
}

(async () => {
  console.log(`Connecting to Chrome (CDP port ${opts.port})...`);

  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${opts.port}`);
  } catch (err) {
    console.error('Failed to connect. Is Chrome running with --remote-debugging-port?');
    console.error('  /usr/bin/google-chrome --remote-debugging-port=9222 &');
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  const contexts = browser.contexts();
  console.log(`Connected. Contexts: ${contexts.length}`);

  // Use existing context or create new one
  const context = contexts[0] || await browser.newContext();
  const existingPages = context.pages();

  let page;
  if (existingPages.length > 0) {
    page = existingPages[0];  // reuse existing tab
    console.log('Using existing page.');
  } else {
    page = await context.newPage();
    console.log('Created new page.');
  }

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    console.log(`URL: ${page.url()}`);
    console.log(`Title: ${await page.title()}`);

    if (opts.wait) {
      console.log(`Waiting ${opts.wait}ms...`);
      await page.waitForTimeout(opts.wait);
    }

    if (opts.dumpHtml) {
      const html = await page.content();
      writeFileSync('/tmp/cdp-page.html', html);
      console.log('HTML saved to /tmp/cdp-page.html');
    }

    await page.screenshot({ path: opts.output, fullPage: true });
    console.log(`Screenshot: ${opts.output}`);

  } catch (err) {
    console.error('Error:', err.message);
    try {
      await page.screenshot({ path: '/tmp/cdp-error.png' });
      console.error('Error screenshot: /tmp/cdp-error.png');
    } catch {}
  } finally {
    await browser.close();
    console.log('Disconnected (Chrome still running).');
  }
})();
