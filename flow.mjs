#!/usr/bin/env node
/**
 * Flow automation — run multi-step browser flows from a JSON definition.
 *
 * No hardcoded URLs, selectors, or credentials. Everything comes from the
 * JSON flow file + --var overrides.
 *
 * Usage:
 *   node flow.mjs flow.json
 *   node flow.mjs flow.json --var URL=http://example.com --var EMAIL=user@example.com
 *   node flow.mjs flow.json --profile ~/.config/google-chrome
 *   node flow.mjs flow.json --headless false
 *
 * Flow JSON format:
 *   {
 *     "name": "Optional description",
 *     "steps": [
 *       { "action": "goto",             "url": "{URL}/login/" },
 *       { "action": "fill",             "selector": "input[name=\"email\"]",   "value": "{EMAIL}" },
 *       { "action": "fill",             "selector": "input[name=\"password\"]","value": "{PASSWORD}" },
 *       { "action": "click",            "selector": "button[type=\"submit\"]" },
 *       { "action": "wait",             "timeout": 2000 },
 *       { "action": "waitSelector",     "selector": ".dashboard-stat", "timeout": 10000 },
 *       { "action": "screenshot",       "path": "/tmp/step1.png", "fullPage": true },
 *       { "action": "click",            "selector": "a:has-text(\"Content\")" },
 *       { "action": "screenshot",       "path": "/tmp/step2.png" },
 *       { "action": "assertExists",     "selector": "table.data-table" },
 *       { "action": "assertText",       "selector": "h1", "contains": "Dashboard" },
 *       { "action": "assertUrl",        "contains": "/dashboard/" },
 *       { "action": "extractText",      "selector": ".stat-value", "save": "statValue" },
 *       { "action": "extractHtml",      "selector": ".content-area", "save": "contentHtml" },
 *       { "action": "scrollTo",         "selector": "#footer" },
 *       { "action": "hover",            "selector": ".dropdown-toggle" },
 *       { "action": "selectOption",     "selector": "select#page", "value": "2" },
 *       { "action": "evaluate",         "code": "document.title", "save": "pageTitle" },
 *       { "action": "log",              "message": "Flow step {step} complete" },
 *       { "action": "reload" },
 *       { "action": "keyPress",         "key": "Enter" },
 *     ]
 *   }
 *
 * Actions:
 *   goto         Navigate to URL.                   { "url": "..." }
 *   fill         Type into field.                   { "selector": "...", "value": "..." }
 *   click        Click element.                     { "selector": "..." }
 *   wait         Wait milliseconds.                 { "timeout": 2000 }
 *   waitSelector Wait for element to appear.        { "selector": "...", "timeout": 10000 }
 *   screenshot   Save screenshot.                   { "path": "...", "fullPage": true }
 *   assertExists Assert element exists in DOM.      { "selector": "..." }
 *   assertText   Assert element text contains.      { "selector": "...", "contains": "..." }
 *   assertUrl    Assert current URL contains.       { "contains": "..." }
 *   extractText  Save element text to result.       { "selector": "...", "save": "varName" }
 *   extractHtml  Save element HTML to result.       { "selector": "...", "save": "varName" }
 *   scrollTo     Scroll to element.                 { "selector": "..." }
 *   hover        Hover over element.                { "selector": "..." }
 *   selectOption Select dropdown option.            { "selector": "...", "value": "..." }
 *   evaluate     Run JS in page context.            { "code": "...", "save": "varName" }
 *   log          Print message to stdout.           { "message": "..." }
 *   reload       Reload current page.
 *   keyPress     Press a keyboard key.              { "key": "Enter" }
 */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'fs';

// --- Parse CLI ---
const args = process.argv.slice(2);
let flowFile = null;
const cliVars = {};
let profileDir = null;
let headless = true;
let outputDir = '/tmp';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--var' && args[i+1]) {
    const m = args[++i].match(/^([^=]+)=(.*)$/);
    if (m) cliVars[m[1]] = m[2];
    else cliVars[args[i]] = '';
  } else if (args[i] === '--profile' && args[i+1]) {
    profileDir = args[++i];
  } else if (args[i] === '--headless' && args[i+1]) {
    headless = args[++i] !== 'false';
  } else if (args[i] === '--output' && args[i+1]) {
    outputDir = args[++i];
  } else if (!flowFile) {
    flowFile = args[i];
  }
}

if (!flowFile || !existsSync(flowFile)) {
  console.error('Usage: node flow.mjs <flow.json> [options]');
  console.error('Options:');
  console.error('  --var KEY=VALUE        Override variable in flow');
  console.error('  --profile <dir>        Use Chrome profile (authenticated session)');
  console.error('  --headless true|false  Run headed or headless (default: true)');
  console.error('  --output <dir>         Output directory for results (default: /tmp)');
  process.exit(1);
}

// --- Load flow ---
const raw = readFileSync(flowFile, 'utf-8');
const flow = JSON.parse(raw);
const steps = flow.steps || [];

// Merge vars: flow.vars + CLI overrides
const vars = { ...(flow.vars || {}), ...cliVars };

// Resolve {KEY} in string values
function resolve(val) {
  if (typeof val !== 'string') return val;
  return val.replace(/\{(\w+)\}/g, (_, k) => vars[k] !== undefined ? vars[k] : `{${k}}`);
}

// --- Run flow ---
(async () => {
  const launchOpts = {
    channel: 'chrome',
    headless,
    args: ['--no-sandbox', '--disable-gpu', '--ignore-certificate-errors'],
  };
  if (profileDir) launchOpts.args.push(`--user-data-dir=${profileDir}`);

  const browser = await chromium.launch(launchOpts);
  const context = profileDir
    ? await browser.newContext({ ignoreHTTPSErrors: true })
    : await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();

  const results = {};
  let failed = false;

  // Store page errors
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));

  console.log(`Flow: ${flow.name || '(unnamed)'}`);
  console.log(`Steps: ${steps.length}`);
  console.log('---');

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepNum = i + 1;
    const label = step.label || step.action;
    const savedVars = { step: stepNum, ...vars, ...results };

    if (failed && step.action !== 'screenshot') {
      // Skip remaining steps on failure, except screenshot for error capture
      continue;
    }

    try {
      switch (step.action) {
        case 'goto': {
          const url = resolve(step.url);
          await page.goto(url, { waitUntil: step.waitUntil || 'networkidle', timeout: step.timeout || 30000 });
          console.log(`  ${stepNum}. goto → ${page.url()}`);
          break;
        }

        case 'fill': {
          const sel = resolve(step.selector);
          const val = resolve(step.value);
          await page.fill(sel, val);
          console.log(`  ${stepNum}. fill ${sel} = "${val}"`);
          break;
        }

        case 'click': {
          const sel = resolve(step.selector);
          await page.click(sel);
          if (step.wait) await page.waitForTimeout(step.wait);
          if (step.waitUntil) await page.waitForLoadState(step.waitUntil);
          console.log(`  ${stepNum}. click ${sel}`);
          break;
        }

        case 'wait': {
          await page.waitForTimeout(step.timeout || 1000);
          console.log(`  ${stepNum}. wait ${step.timeout || 1000}ms`);
          break;
        }

        case 'waitSelector': {
          const sel = resolve(step.selector);
          await page.waitForSelector(sel, { timeout: step.timeout || 10000, state: 'visible' });
          console.log(`  ${stepNum}. waitSelector ${sel}`);
          break;
        }

        case 'screenshot': {
          const path = resolve(step.path) || `${outputDir}/flow-step-${stepNum}.png`;
          await page.screenshot({ path, fullPage: step.fullPage || false });
          console.log(`  ${stepNum}. screenshot → ${path}`);
          break;
        }

        case 'assertExists': {
          const sel = resolve(step.selector);
          const el = await page.$(sel);
          if (!el) throw new Error(`Element not found: ${sel}`);
          console.log(`  ${stepNum}. assertExists ${sel} ✓`);
          break;
        }

        case 'assertText': {
          const sel = resolve(step.selector);
          const text = await page.textContent(sel);
          const expect = resolve(step.contains);
          if (!text || !text.includes(expect)) {
            throw new Error(`assertText fail: "${sel}" text "${text?.trim()}" does not contain "${expect}"`);
          }
          console.log(`  ${stepNum}. assertText ${sel} contains "${expect}" ✓`);
          break;
        }

        case 'assertUrl': {
          const currentUrl = page.url();
          const expect = resolve(step.contains);
          if (!currentUrl.includes(expect)) {
            throw new Error(`assertUrl fail: "${currentUrl}" does not contain "${expect}"`);
          }
          console.log(`  ${stepNum}. assertUrl contains "${expect}" ✓`);
          break;
        }

        case 'extractText': {
          const sel = resolve(step.selector);
          const text = await page.textContent(sel);
          results[step.save] = text?.trim() || '';
          console.log(`  ${stepNum}. extractText ${sel} → $${step.save} = "${results[step.save].slice(0, 60)}"`);
          break;
        }

        case 'extractHtml': {
          const sel = resolve(step.selector);
          const html = await page.innerHTML(sel);
          results[step.save] = html || '';
          console.log(`  ${stepNum}. extractHtml ${sel} → $${step.save} (${(html?.length || 0)} chars)`);
          break;
        }

        case 'scrollTo': {
          const sel = resolve(step.selector);
          await page.$eval(sel, el => el.scrollIntoView({ behavior: 'instant', block: 'center' }));
          console.log(`  ${stepNum}. scrollTo ${sel}`);
          break;
        }

        case 'hover': {
          const sel = resolve(step.selector);
          await page.hover(sel);
          if (step.wait) await page.waitForTimeout(step.wait);
          console.log(`  ${stepNum}. hover ${sel}`);
          break;
        }

        case 'selectOption': {
          const sel = resolve(step.selector);
          const val = resolve(step.value);
          await page.selectOption(sel, val);
          console.log(`  ${stepNum}. selectOption ${sel} = "${val}"`);
          break;
        }

        case 'evaluate': {
          const code = resolve(step.code);
          const result = await page.evaluate(code);
          if (step.save) {
            results[step.save] = result;
            console.log(`  ${stepNum}. evaluate → $${step.save} = ${JSON.stringify(result).slice(0, 80)}`);
          } else {
            console.log(`  ${stepNum}. evaluate → ${JSON.stringify(result).slice(0, 80)}`);
          }
          break;
        }

        case 'log': {
          const msg = resolve(step.message);
          console.log(`  ${stepNum}. ${msg}`);
          break;
        }

        case 'reload': {
          await page.reload({ waitUntil: 'networkidle' });
          console.log(`  ${stepNum}. reload → ${page.url()}`);
          break;
        }

        case 'keyPress': {
          const key = resolve(step.key);
          await page.keyboard.press(key);
          console.log(`  ${stepNum}. keyPress "${key}"`);
          break;
        }

        default:
          console.warn(`  ${stepNum}. Unknown action: "${step.action}" — skipped`);
      }
    } catch (err) {
      failed = true;
      console.error(`  ${stepNum}. ❌ ${step.action}: ${err.message}`);
      // Screenshot on failure
      try {
        const errPath = `${outputDir}/flow-error-step-${stepNum}.png`;
        await page.screenshot({ path: errPath, fullPage: true });
        console.error(`     Error screenshot: ${errPath}`);
      } catch {}
    }
  }

  console.log('---');
  if (failed) {
    console.log('Result: ❌ FAILED');
    if (pageErrors.length) console.log(`Page errors: ${pageErrors.join('; ')}`);
    process.exit(1);
  } else {
    console.log('Result: ✅ PASSED');
  }

  await browser.close();
})();
