'use strict';
// "Desktop app" mode: show the local UI in a standalone browser window (no tabs / address bar),
// plus launcher shortcuts so it can be started like any other app.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const core = require('./core');

const BIN = path.resolve(__dirname, '..', 'bin', 'ccaccounts.js');
const which = (b) => spawnSync('sh', ['-c', `command -v ${b}`], { stdio: 'ignore' }).status === 0;

// Chromium-based browsers support --app=URL. Edge ships with Windows, so try it first there.
function findAppBrowser() {
  if (process.env.CCACCOUNTS_BROWSER) return process.env.CCACCOUNTS_BROWSER;
  const p = process.platform;
  const pick = (list) => list.find((f) => fs.existsSync(f)) || null;
  if (p === 'win32') {
    const roots = [process.env['PROGRAMFILES(X86)'], process.env.PROGRAMFILES, process.env.LOCALAPPDATA].filter(Boolean);
    return pick(roots.flatMap((r) => [
      path.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ]));
  }
  if (p === 'darwin') {
    return pick(['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                 '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']);
  }
  return ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'].find(which) || null;
}

// Own user-data-dir keeps this window separate from the browsers' normal profiles, so closing
// the window ends the process (we use that to stop the server).
function openAppWindow(url) {
  const exe = findAppBrowser();
  if (!exe) throw new Error('No Chrome or Edge found. Install one, or set CCACCOUNTS_BROWSER to the browser executable.');
  const data = path.join(core.root(), 'app-window');
  fs.mkdirSync(data, { recursive: true });
  const c = spawn(exe, [`--app=${url}`, `--user-data-dir=${data}`, '--no-first-run', '--window-size=820,900'],
    { stdio: 'ignore' });
  c.on('error', () => {});
  return c;
}

function startApp() {
  return require('./ui').start({ port: 4455, open: false }).then(({ server, url }) => {
    const t0 = Date.now();
    const win = openAppWindow(url);
    win.on('exit', () => {
      // An instant exit means the window was handed to an already-running instance; keep serving.
      if (Date.now() - t0 < 3000) return;
      server.close(); process.exit(0);
    });
    return url;
  });
}

// ---- shortcuts -------------------------------------------------------------

const q = (s) => `"${s}"`;

function createShortcut() {
  const node = process.execPath;
  const home = os.homedir();

  if (process.platform === 'win32') {
    // A .vbs launcher runs node hidden, so no console window flashes up.
    fs.mkdirSync(core.root(), { recursive: true });
    const vbs = path.join(core.root(), 'launch.vbs');
    const cmd = `${q(node)} ${q(BIN)} app`.replace(/"/g, '""');
    fs.writeFileSync(vbs, `CreateObject("WScript.Shell").Run "${cmd}", 0, False\r\n`);
    const dirs = [path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
                  path.join(home, 'Desktop')].filter((d) => fs.existsSync(d));
    const made = [];
    for (const d of dirs) {
      const lnk = path.join(d, 'ccaccounts.lnk');
      const ps = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${lnk.replace(/'/g, "''")}');` +
        `$s.TargetPath='wscript.exe';$s.Arguments='"${vbs.replace(/'/g, "''")}"';` +
        `$s.Description='Claude Code account switcher';$s.IconLocation='${path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'imageres.dll').replace(/'/g, "''")},109';$s.Save()`;
      const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' });
      if (r.status === 0) made.push(lnk);
    }
    if (!made.length) throw new Error('Could not create a shortcut');
    return made;
  }

  if (process.platform === 'darwin') {
    const app = path.join(home, 'Applications', 'ccaccounts.app');
    fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
    fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'),
      `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleName</key><string>ccaccounts</string>` +
      `<key>CFBundleExecutable</key><string>launcher</string><key>CFBundleIdentifier</key><string>dev.ccaccounts.app</string>` +
      `<key>CFBundlePackageType</key><string>APPL</string></dict></plist>\n`);
    const sh = path.join(app, 'Contents', 'MacOS', 'launcher');
    fs.writeFileSync(sh, `#!/bin/sh\nexec ${q(node)} ${q(BIN)} app\n`, { mode: 0o755 });
    return [app];
  }

  const dir = path.join(home, '.local', 'share', 'applications');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'ccaccounts.desktop');
  fs.writeFileSync(f, `[Desktop Entry]\nType=Application\nName=ccaccounts\nComment=Claude Code account switcher\n` +
    `Exec=${q(node)} ${q(BIN)} app\nTerminal=false\nCategories=Development;\n`);
  return [f];
}

function removeShortcut() {
  const home = os.homedir();
  const files = process.platform === 'win32'
    ? [path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'ccaccounts.lnk'),
       path.join(home, 'Desktop', 'ccaccounts.lnk'), path.join(core.root(), 'launch.vbs')]
    : process.platform === 'darwin' ? [path.join(home, 'Applications', 'ccaccounts.app')]
    : [path.join(home, '.local', 'share', 'applications', 'ccaccounts.desktop')];
  return files.filter((f) => { if (!fs.existsSync(f)) return false; fs.rmSync(f, { recursive: true, force: true }); return true; });
}

module.exports = { findAppBrowser, startApp, createShortcut, removeShortcut };
