'use strict';
// One dedicated Chrome profile per account, so the Claude in Chrome extension can be
// signed in to the same claude.ai account as that Claude Code profile.
//
// The profile lives inside Chrome's normal user-data dir (not a custom --user-data-dir)
// because Claude Code registers its native-messaging host there.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const EXT_ID = 'fcoeoabgfenejglbffodgkkbkcdhcgfn';
const STORE_URL = `https://chromewebstore.google.com/detail/claude/${EXT_ID}`;
const LOGIN_URL = 'https://claude.ai/login';
const USAGE_URL = 'https://claude.ai/settings/usage'; // the official plan-limit numbers; Claude Code keeps none locally

const profileDirName = (name) => `ccaccounts-${name}`;

function userDataDir() {
  if (process.env.CCACCOUNTS_CHROME_DATA) return process.env.CCACCOUNTS_CHROME_DATA;
  const home = os.homedir();
  if (process.platform === 'win32')
    return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Google', 'Chrome', 'User Data');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Google', 'Chrome');
  return path.join(home, '.config', 'google-chrome');
}

// What we can verify from disk. We can NOT see whether the extension itself is signed in.
function status(name) {
  const dir = path.join(userDataDir(), profileDirName(name));
  return {
    profileExists: fs.existsSync(dir),
    extensionInstalled: fs.existsSync(path.join(dir, 'Extensions', EXT_ID)),
  };
}

function findChrome() {
  if (process.env.CCACCOUNTS_BROWSER) return process.env.CCACCOUNTS_BROWSER;
  if (process.platform === 'darwin')
    return fs.existsSync('/Applications/Google Chrome.app') ? '/Applications/Google Chrome.app' : null;
  if (process.platform === 'win32') {
    const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
    for (const r of roots) {
      const p = path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe');
      if (fs.existsSync(p)) return p;
    }
    return null;
  }
  for (const b of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    if (spawnSync('sh', ['-c', `command -v ${b}`], { stdio: 'ignore' }).status === 0) return b;
  }
  return null;
}

// Opens this account's Chrome profile on the claude.ai login page and the extension page.
function openProfile(name, { install = true, url = '' } = {}) {
  const exe = findChrome();
  if (!exe) throw new Error('Google Chrome not found. Install it, or set CCACCOUNTS_BROWSER to the browser executable.');
  const st = status(name);
  const urls = [url || LOGIN_URL];
  if (install && !url && !st.extensionInstalled) urls.push(STORE_URL);
  const flags = [`--profile-directory=${profileDirName(name)}`, '--no-first-run', ...urls];

  const [cmd, args] = process.platform === 'darwin'
    ? ['open', ['-na', exe, '--args', ...flags]]
    : [exe, flags];
  const c = spawn(cmd, args, { detached: true, stdio: 'ignore' });
  c.on('error', () => {});
  c.unref();
  return { opened: urls };
}

module.exports = { EXT_ID, STORE_URL, LOGIN_URL, USAGE_URL, profileDirName, userDataDir, status, findChrome, openProfile };
