'use strict';
// Open a new terminal window running `claude` as a given profile, and open URLs.
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const core = require('./core');

const sq = (s) => "'" + s.replace(/'/g, "'\\''") + "'"; // POSIX single-quote

function detached(cmd, args, opts = {}) {
  const c = spawn(cmd, args, { detached: true, stdio: 'ignore', ...opts });
  c.on('error', () => {});
  c.unref();
}

function has(cmd) {
  return spawnSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }).status === 0;
}

const hasWt = () => spawnSync('where', ['wt'], { stdio: 'ignore' }).status === 0;

// Windows: a small launcher script per account avoids nested-quote trouble across cmd / PowerShell / Windows Terminal.
function buildWin(name, cwd, argLine, terminal, scriptDir) {
  const dir = core.profilePath(name);
  if (terminal === 'powershell') {
    const f = path.join(scriptDir, `${name}.ps1`), p = (s) => s.replace(/'/g, "''");
    return { file: f, content: `Set-Location -LiteralPath '${p(cwd)}'\r\n$env:CLAUDE_CONFIG_DIR = '${p(dir)}'\r\nclaude ${argLine}\r\n`,
             exe: 'cmd.exe', args: ['/d', '/c', 'start', '', 'powershell', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', f] };
  }
  const f = path.join(scriptDir, `${name}.cmd`), pc = (s) => s.replace(/%/g, '%%');
  const content = `@echo off\r\ncd /d "${pc(cwd)}"\r\nset "CLAUDE_CONFIG_DIR=${pc(dir)}"\r\nclaude ${argLine}\r\n`;
  return terminal === 'wt'
    ? { file: f, content, exe: 'wt.exe', args: ['-d', cwd, 'cmd', '/k', f] }
    : { file: f, content, exe: 'cmd.exe', args: ['/d', '/c', 'start', '', 'cmd', '/k', f] };
}

// `extra` is appended after the account's own extra options (e.g. "--resume <id>").
function openTerminal(name, cwd, extra = '') {
  const dir = core.profilePath(name);
  if (!core.exists(name)) throw new Error(`No such profile: ${name}`);
  const st = core.getSettings(name);
  const argLine = [st.args, extra].filter(Boolean).join(' ');

  if (process.platform === 'win32') {
    const scriptDir = path.join(core.root(), 'launch');
    fs.mkdirSync(scriptDir, { recursive: true });
    const w = buildWin(name, cwd, argLine, st.terminal === 'wt' && !hasWt() ? '' : st.terminal, scriptDir);
    fs.writeFileSync(w.file, w.content);
    detached(w.exe, w.args);
    return;
  }

  const script = `cd ${sq(cwd)} && CLAUDE_CONFIG_DIR=${sq(dir)} claude ${argLine}; exec "$SHELL"`;
  if (process.platform === 'darwin') {
    const esc = script.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    detached('osascript', ['-e', `tell application "Terminal" to activate`,
                           '-e', `tell application "Terminal" to do script "${esc}"`]);
    return;
  }

  const candidates = [
    ['x-terminal-emulator', ['-e']], ['gnome-terminal', ['--']], ['konsole', ['-e']],
    ['xfce4-terminal', ['-x']], ['kitty', []], ['alacritty', ['-e']], ['xterm', ['-e']],
  ];
  for (const [bin, pre] of candidates) {
    if (has(bin)) { detached(bin, [...pre, 'sh', '-c', script]); return; }
  }
  throw new Error('No terminal emulator found. Run in a terminal: ccaccounts login ' + name);
}

function openUrl(url) {
  if (process.platform === 'win32') detached('cmd.exe', ['/c', 'start', '""', url.replace(/&/g, '^&')], { windowsVerbatimArguments: true });
  else if (process.platform === 'darwin') detached('open', [url]);
  else detached('xdg-open', [url]);
}

module.exports = { openTerminal, openUrl, buildWin };
