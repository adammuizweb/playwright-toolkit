#!/usr/bin/env node
/**
 * Extract cookies from a Chrome profile and save as JSON.
 * These cookies can be loaded with --cookies flag in other scripts.
 *
 * Usage:
 *   node extract-cookies.mjs ~/.config/google-chrome [output.json]
 *
 * Requires: sqlite3 CLI installed
 */

import { execSync } from 'child_process';
import { writeFileSync, existsSync } from 'fs';

const profileDir = process.argv[2];
const output = process.argv[3] || '/tmp/cookies.json';

if (!profileDir) {
  console.error('Usage: node extract-cookies.mjs <profile-dir> [output.json]');
  process.exit(1);
}

const cookiesDb = `${profileDir}/Default/Cookies`;
if (!existsSync(cookiesDb)) {
  console.error(`Cookies database not found: ${cookiesDb}`);
  process.exit(1);
}

try {
  // Verify sqlite3 is available
  execSync('sqlite3 --version', { stdio: 'pipe' });
} catch {
  console.error('sqlite3 CLI not found. Install with: apt install sqlite3');
  process.exit(1);
}

try {
  console.log(`Reading cookies from: ${cookiesDb}`);
  const result = execSync(
    `sqlite3 "${cookiesDb}" "SELECT host_key, name, value, path, is_secure, is_httponly, expires_utc, samesite FROM cookies WHERE host_key LIKE '%.google.com' OR host_key LIKE '%.gemini.google.com' OR host_key LIKE '%accounts.google.com';" -separator '|'`,
    { encoding: 'utf-8', timeout: 5000 }
  );

  const lines = result.trim().split('\n').filter(Boolean);
  const cookies = lines.map(line => {
    const [host, name, value, path, secure, httponly, expires, samesite] = line.split('|');
    return {
      name,
      value,
      domain: host,
      path: path || '/',
      httpOnly: httponly === '1',
      secure: secure === '1',
      sameSite: ['None', 'Lax', 'Strict'][parseInt(samesite) || 0] || 'Lax',
      expires: expires ? Math.round(parseInt(expires) / 1000000) : -1,
    };
  });

  if (cookies.length === 0) {
    console.log('No Google cookies found.');
    process.exit(0);
  }

  writeFileSync(output, JSON.stringify(cookies, null, 2));
  console.log(`Extracted ${cookies.length} cookies → ${output}`);
  console.log(`Domains: ${[...new Set(cookies.map(c => c.domain))].join(', ')}`);
} catch (err) {
  console.error('Failed to extract cookies:', err.message);
  process.exit(1);
}
