'use strict';
// Open a new terminal window running `claude` as a given profile, and open URLs.
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

function openTerminal(name, cwd) {
  const dir = core.profilePath(name);
  if (!core.exists(name)) throw new Error(`No such profile: ${name}`);

  if (process.platform === 'win32') {
    const line = `start "" cmd /k "cd /d "${cwd}" && set "CLAUDE_CONFIG_DIR=${dir}" && claude"`;
    detached('cmd.exe', ['/d', '/s', '/c', line], { windowsVerbatimArguments: true });
    return;
  }

  const script = `cd ${sq(cwd)} && CLAUDE_CONFIG_DIR=${sq(dir)} claude; exec "$SHELL"`;
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

module.exports = { openTerminal, openUrl };
