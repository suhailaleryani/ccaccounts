'use strict';
// "Desktop app" mode: show the local UI in a standalone browser window (no tabs / address bar),
// plus launcher shortcuts so it can be started like any other app.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const core = require('./core');
const icon = require('./icon');

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

// ---- shortcuts and autostart ------------------------------------------------

const q = (s) => `"${s}"`;
const psq = (s) => `'${s.replace(/'/g, "''")}'`;
const home = () => os.homedir();
const exec = () => `${q(process.execPath)} ${q(BIN)} app`;

// Pure builders (unit-tested); the platform code below only decides where the files go.
const desktopEntry = () => `[Desktop Entry]\nType=Application\nName=ccaccounts\nComment=Claude Code account switcher\n` +
  `Exec=${exec()}\nIcon=${path.join(core.root(), 'icon.png')}\nTerminal=false\nCategories=Development;\n`;

const launchAgentPlist = () => `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>` +
  `<key>Label</key><string>dev.ccaccounts.app</string><key>RunAtLoad</key><true/>` +
  `<key>ProgramArguments</key><array><string>${process.execPath}</string><string>${BIN}</string><string>app</string></array>` +
  `</dict></plist>\n`;

// The real Desktop folder (OneDrive often moves it away from ~/Desktop).
function desktopDir() {
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', "[Environment]::GetFolderPath('Desktop')"], { encoding: 'utf8' });
  const d = r.status === 0 ? r.stdout.trim() : '';
  return d && fs.existsSync(d) ? d : path.join(home(), 'Desktop');
}
const programsDir = () => path.join(process.env.APPDATA || path.join(home(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
const startupDir = () => path.join(programsDir(), 'Startup');

function writeIcons() {
  fs.mkdirSync(core.root(), { recursive: true });
  const ico = path.join(core.root(), 'icon.ico');
  fs.writeFileSync(ico, icon.ico());
  fs.writeFileSync(path.join(core.root(), 'icon.png'), icon.png(256));
  return ico;
}

// A .vbs launcher runs node hidden, so no console window flashes up.
function winLauncher() {
  const vbs = path.join(core.root(), 'launch.vbs');
  fs.mkdirSync(core.root(), { recursive: true });
  fs.writeFileSync(vbs, `CreateObject("WScript.Shell").Run "${exec().replace(/"/g, '""')}", 0, False\r\n`);
  return vbs;
}

function makeLnk(lnk, vbs, ico) {
  const ps = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut(${psq(lnk)});` +
    `$s.TargetPath='wscript.exe';$s.Arguments=${psq(`"${vbs}"`)};` +
    `$s.Description='Claude Code account switcher';$s.IconLocation=${psq(ico)};$s.Save()`;
  return spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' }).status === 0;
}

function createShortcut() {
  if (process.platform === 'win32') {
    const vbs = winLauncher(), ico = writeIcons();
    const made = [programsDir(), desktopDir()].filter((d) => fs.existsSync(d))
      .map((d) => path.join(d, 'ccaccounts.lnk')).filter((lnk) => makeLnk(lnk, vbs, ico));
    if (!made.length) throw new Error('Could not create a shortcut');
    return made;
  }

  if (process.platform === 'darwin') {
    const app = path.join(home(), 'Applications', 'ccaccounts.app');
    fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
    fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'),
      `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleName</key><string>ccaccounts</string>` +
      `<key>CFBundleExecutable</key><string>launcher</string><key>CFBundleIdentifier</key><string>dev.ccaccounts.app</string>` +
      `<key>CFBundlePackageType</key><string>APPL</string></dict></plist>\n`);
    fs.writeFileSync(path.join(app, 'Contents', 'MacOS', 'launcher'), `#!/bin/sh\nexec ${exec()}\n`, { mode: 0o755 });
    return [app];
  }

  writeIcons();
  const dir = path.join(home(), '.local', 'share', 'applications');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'ccaccounts.desktop');
  fs.writeFileSync(f, desktopEntry());
  return [f];
}

const autostartFile = () => process.platform === 'win32' ? path.join(startupDir(), 'ccaccounts.lnk')
  : process.platform === 'darwin' ? path.join(home(), 'Library', 'LaunchAgents', 'dev.ccaccounts.app.plist')
  : path.join(home(), '.config', 'autostart', 'ccaccounts.desktop');

// Opt-in: open the window when you sign in to the computer.
function setAutostart(on) {
  const f = autostartFile();
  if (!on) { const had = fs.existsSync(f); fs.rmSync(f, { force: true }); return had ? f : null; }
  fs.mkdirSync(path.dirname(f), { recursive: true });
  if (process.platform === 'win32') {
    if (!makeLnk(f, winLauncher(), writeIcons())) throw new Error('Could not create the startup entry');
  } else if (process.platform === 'darwin') fs.writeFileSync(f, launchAgentPlist());
  else { writeIcons(); fs.writeFileSync(f, desktopEntry()); }
  return f;
}

function removeShortcut() {
  const files = process.platform === 'win32'
    ? [path.join(programsDir(), 'ccaccounts.lnk'), path.join(desktopDir(), 'ccaccounts.lnk'), path.join(home(), 'Desktop', 'ccaccounts.lnk'),
       path.join(core.root(), 'launch.vbs')]
    : process.platform === 'darwin' ? [path.join(home(), 'Applications', 'ccaccounts.app')]
    : [path.join(home(), '.local', 'share', 'applications', 'ccaccounts.desktop')];
  return [...new Set(files)].filter((f) => { if (!fs.existsSync(f)) return false; fs.rmSync(f, { recursive: true, force: true }); return true; });
}

module.exports = { findAppBrowser, startApp, createShortcut, removeShortcut, setAutostart, desktopEntry, launchAgentPlist };
