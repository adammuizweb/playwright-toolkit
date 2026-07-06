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
import { readFileSync, existsSync } from 'fs';

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
  cookies: null,
};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--lang' && args[i+1]) opts.lang = args[++i];
  if (args[i] === '--psm' && args[i+1]) opts.psm = parseInt(args[++i]);
  if (args[i] === '--login') opts.login = true;
  if (args[i] === '--email' && args[i+1]) opts.email = args[++i];
  if (args[i] === '--password' && args[i+1]) opts.password = args[++i];
  if (args[i] === '--profile' && args[i+1]) opts.profile = args[++i];
  if (args[i] === '--cookies' && args[i+1]) opts.cookies = args[++i];
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
  const baseArgs = ['--no-sandbox', '--disable-gpu', '--ignore-certificate-errors'];

  try {
    let page;

    if (opts.profile) {
      const context = await chromium.launchPersistentContext(opts.profile, {
        channel: 'chrome',
        args: baseArgs,
        viewport: { width: 1280, height: 720 },
        ignoreHTTPSErrors: true,
      });
      const pages = context.pages();
      page = pages.length > 0 ? pages[0] : await context.newPage();
      await runOcr(page);
      await context.close();
    } else {
      const browser = await chromium.launch({ channel: 'chrome', args: baseArgs });
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true });
      if (opts.cookies && existsSync(opts.cookies)) {
        const cookies = JSON.parse(readFileSync(opts.cookies, 'utf-8'));
        await context.addCookies(cookies);
        console.log(`Loaded ${cookies.length} cookies`);
      }
      page = await context.newPage();
      await runOcr(page);
      await browser.close();
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }

  async function runOcr(page) {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

    if (opts.login) {
      if (opts.email) await page.fill('input[type="email"], input[name="email"]', opts.email);
      if (opts.password) await page.fill('input[type="password"], input[name="password"]', opts.password);
      await page.click('button[type="submit"]');
      await page.waitForTimeout(2000);
    }

    await page.screenshot({ path: opts.output, fullPage: false });
    console.log(`Screenshot: ${opts.output}`);

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
  }
})();
