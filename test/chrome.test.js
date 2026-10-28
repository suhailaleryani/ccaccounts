'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccaccounts-chrome-'));
process.env.CCACCOUNTS_CHROME_DATA = path.join(tmp, 'chrome-data');
const chrome = require('../lib/chrome');

test('status reflects profile + extension on disk', () => {
  assert.deepEqual(chrome.status('work'), { profileExists: false, extensionInstalled: false });
  const dir = path.join(process.env.CCACCOUNTS_CHROME_DATA, 'ccaccounts-work');
  fs.mkdirSync(dir, { recursive: true });
  assert.deepEqual(chrome.status('work'), { profileExists: true, extensionInstalled: false });
  fs.mkdirSync(path.join(dir, 'Extensions', chrome.EXT_ID), { recursive: true });
  assert.equal(chrome.status('work').extensionInstalled, true);
});

test('openProfile launches the per-account profile with login + store pages', { skip: process.platform === 'win32' || process.platform === 'darwin' }, async () => {
  const out = path.join(tmp, 'args.txt');
  const exe = path.join(tmp, 'fake-chrome');
  fs.writeFileSync(exe, `#!/bin/sh\nprintf '%s\\n' "$@" > "${out}"\n`, { mode: 0o755 });
  process.env.CCACCOUNTS_BROWSER = exe;
  chrome.openProfile('personal');
  for (let i = 0; i < 50 && !fs.existsSync(out); i++) await new Promise((r) => setTimeout(r, 40));
  const args = fs.readFileSync(out, 'utf8').trim().split('\n');
  assert.ok(args.includes('--profile-directory=ccaccounts-personal'));
  assert.ok(args.includes(chrome.LOGIN_URL));
  assert.ok(args.includes(chrome.STORE_URL)); // extension not installed yet -> store page opens too
});

test('usage page opens alone in the account profile (no login or store tab)', { skip: process.platform === 'win32' || process.platform === 'darwin' }, async () => {
  const out = path.join(tmp, 'args-usage.txt');
  const exe = path.join(tmp, 'fake-chrome-usage');
  fs.writeFileSync(exe, `#!/bin/sh\nprintf '%s\\n' "$@" > "${out}"\n`, { mode: 0o755 });
  process.env.CCACCOUNTS_BROWSER = exe;
  chrome.openProfile('personal', { install: false, url: chrome.USAGE_URL });
  for (let i = 0; i < 50 && !fs.existsSync(out); i++) await new Promise((r) => setTimeout(r, 40));
  const args = fs.readFileSync(out, 'utf8').trim().split('\n');
  assert.ok(args.includes('--profile-directory=ccaccounts-personal'));
  assert.ok(args.includes('https://claude.ai/settings/usage'));
  assert.ok(!args.includes(chrome.LOGIN_URL) && !args.includes(chrome.STORE_URL));
});
