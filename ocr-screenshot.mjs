#!/usr/bin/env node
/**
 * Screenshot + OCR pipeline.
 * Takes a screenshot of a URL, then OCRs it with Tesseract.
 * Usage:
 *   node ocr-screenshot.mjs <url> [--lang eng] [--psm 6]
 *   node ocr-screenshot.mjs <url> --login --email <email> --password <pass>
 *   node ocr-screenshot.mjs <url> --profile ~/.config/google-chrome
 */

import { chromium } from 'playwright';
import { execSync } from 'child_process';

const [,, url] = process.argv;
const args = process.argv.slice(3);

const opts = {
  output: '/tmp/ocr-screenshot.png',
  lang: 'eng',
  psm: 6,
  login: false,
  email: '',
  password: '',
  profile: null,
};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--lang' && args[i+1]) opts.lang = args[++i];
  if (args[i] === '--psm' && args[i+1]) opts.psm = parseInt(args[++i]);
  if (args[i] === '--login') opts.login = true;
  if (args[i] === '--email' && args[i+1]) opts.email = args[++i];
  if (args[i] === '--password' && args[i+1]) opts.password = args[++i];
  if (args[i] === '--profile' && args[i+1]) opts.profile = args[++i];
}

if (!url) {
  console.error('Usage: node ocr-screenshot.mjs <url> [options]');
  console.error('Options:');
  console.error('  --lang <code>      Tesseract language (default: eng)');
  console.error('  --psm <num>        Tesseract PSM mode (default: 6)');
  console.error('  --login            Login before screenshot');
  console.error('  --email <email>    Login email');
  console.error('  --password <pass>  Login password');
  console.error('  --profile <dir>    Use existing Chrome profile');
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

  try {
    const context = opts.profile
      ? await browser.newContext({ ignoreHTTPSErrors: true })
      : await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true });
    const page = await context.newPage();

    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

    if (opts.login) {
      if (opts.email) await page.fill('input[type="email"], input[name="email"]', opts.email);
      if (opts.password) await page.fill('input[type="password"], input[name="password"]', opts.password);
      await page.click('button[type="submit"]');
      await page.waitForTimeout(2000);
    }

    await page.screenshot({ path: opts.output, fullPage: false });
    console.log(`Screenshot: ${opts.output}`);
    await browser.close();

    // OCR with Tesseract
    const textFile = '/tmp/ocr-output';
    execSync(`tesseract ${opts.output} ${textFile} -l ${opts.lang} --psm ${opts.psm} 2>/dev/null`);
    const { readFileSync } = await import('fs');
    const text = readFileSync(`${textFile}.txt`, 'utf-8').trim();

    if (text) {
      console.log('\n=== OCR Result ===');
      console.log(text);
      console.log('==================\n');
    } else {
      console.log('No text detected.');
    }

    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    try {
      const { chromium: c2 } = await import('playwright');
      const b2 = await c2.launch({ channel: 'chrome', args: ['--no-sandbox'] });
      const p2 = await b2.newPage();
      const s = await p2.context().newPage();
      await s.goto('about:blank');
      await s.screenshot({ path: '/tmp/ocr-error.png' });
      await b2.close();
    } catch {}
    process.exit(1);
  }
})();
