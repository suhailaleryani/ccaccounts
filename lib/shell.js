'use strict';
// Shell integration: a `claude` wrapper that always uses the active profile, plus installers.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const MARK = '# >>> ccaccounts >>>';
const END = '# <<< ccaccounts <<<';

const hooks = {
  // Exit code 130 from \`ccaccounts path\` means the user cancelled the "which account?" prompt: don't start claude.
  bash: `claude() {
  local d rc=0
  if command -v ccaccounts >/dev/null 2>&1; then d="$(ccaccounts path "$@")"; rc=$?; fi
  [ "$rc" -eq 130 ] && return 130
  if [ "$rc" -eq 0 ] && [ -n "$d" ]; then CLAUDE_CONFIG_DIR="$d" command claude "$@"; else command claude "$@"; fi
}`,
  fish: `function claude
  set -l d
  if command -q ccaccounts
    set d (ccaccounts path $argv)
    if test $status -eq 130
      return 130
    end
  end
  if test -n "$d"
    env CLAUDE_CONFIG_DIR=$d claude $argv
  else
    command claude $argv
  end
end`,
  powershell: `function claude {
  $d = $null
  if (Get-Command ccaccounts -ErrorAction SilentlyContinue) {
    $d = ccaccounts path @args
    if ($LASTEXITCODE -eq 130) { return }
  }
  $exe = (Get-Command claude -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
  if ($d) {
    $old = $env:CLAUDE_CONFIG_DIR; $env:CLAUDE_CONFIG_DIR = $d
    try { & $exe @args } finally { $env:CLAUDE_CONFIG_DIR = $old }
  } else { & $exe @args }
}`,
};
hooks.zsh = hooks.bash;

function detectShell() {
  if (process.platform === 'win32') return process.env.PSModulePath ? 'powershell' : 'cmd';
  const s = path.basename(process.env.SHELL || 'bash');
  return ['bash', 'zsh', 'fish'].includes(s) ? s : 'bash';
}

function hookFor(shell) {
  if (shell === 'cmd') {
    throw new Error('cmd.exe cannot define functions. Use PowerShell, or run `ccaccounts claude` instead of `claude`.');
  }
  if (!hooks[shell]) throw new Error(`Unknown shell "${shell}". Use: bash, zsh, fish, powershell`);
  return hooks[shell];
}

// Print the line that sets CLAUDE_CONFIG_DIR in the given shell (for IDEs / other tools).
function envLine(shell, dir) {
  if (shell === 'powershell') return `$env:CLAUDE_CONFIG_DIR = "${dir}"`;
  if (shell === 'cmd') return `set "CLAUDE_CONFIG_DIR=${dir}"`;
  if (shell === 'fish') return `set -gx CLAUDE_CONFIG_DIR "${dir}"`;
  return `export CLAUDE_CONFIG_DIR="${dir}"`;
}

function powershellProfiles() {
  // Ask PowerShell itself where $PROFILE is; fall back to the usual Documents paths.
  for (const exe of ['pwsh', 'powershell']) {
    const r = spawnSync(exe, ['-NoProfile', '-Command', '$PROFILE'], { encoding: 'utf8' });
    if (!r.error && r.status === 0 && r.stdout.trim()) return [r.stdout.trim()];
  }
  const docs = path.join(os.homedir(), 'Documents');
  return [path.join(docs, 'PowerShell', 'Microsoft.PowerShell_profile.ps1'),
          path.join(docs, 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1')];
}

function rcFiles(shell) {
  const h = os.homedir();
  if (shell === 'zsh') return [path.join(h, '.zshrc')];
  if (shell === 'fish') return [path.join(h, '.config', 'fish', 'config.fish')];
  if (shell === 'powershell') return powershellProfiles();
  // bash: macOS login shells read .bash_profile, Linux reads .bashrc
  return [path.join(h, process.platform === 'darwin' ? '.bash_profile' : '.bashrc')];
}

// cmd.exe has no functions, but a doskey macro run from the AutoRun registry value gives the same effect
// at an interactive prompt (and never touches PATH, so the real claude is still what ccaccounts launches).
const CMD_MACRO = 'doskey claude=ccaccounts claude $*';
const CMD_KEY = 'HKCU\\Software\\Microsoft\\Command Processor';
const CMD_LABEL = 'Command Prompt AutoRun (' + CMD_KEY + ')';

function readAutoRun() {
  const r = spawnSync('reg', ['query', CMD_KEY, '/v', 'AutoRun'], { encoding: 'utf8', windowsHide: true });
  const m = r.status === 0 && /AutoRun\s+(REG_\w+)\s+(.*)/.exec(r.stdout);
  return m ? { type: m[1], value: m[2].trim() } : { type: 'REG_SZ', value: '' };
}

function writeAutoRun(type, value) {
  const args = value
    ? ['add', CMD_KEY, '/v', 'AutoRun', '/t', type, '/d', value, '/f']
    : ['delete', CMD_KEY, '/v', 'AutoRun', '/f'];
  const r = spawnSync('reg', args, { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error('Could not update the Command Prompt AutoRun setting: ' + (r.stderr || r.stdout || '').trim());
}

function cmdInstalled() { return readAutoRun().value.includes(CMD_MACRO); }

function installCmd() {
  const { type, value } = readAutoRun();
  if (!value.includes(CMD_MACRO)) writeAutoRun(type, value ? `${value} & ${CMD_MACRO}` : CMD_MACRO);
  return [CMD_LABEL];
}

function uninstallCmd() {
  const { type, value } = readAutoRun();
  if (!value.includes(CMD_MACRO)) return [];
  const next = value.replace(` & ${CMD_MACRO}`, '').replace(`${CMD_MACRO} & `, '').replace(CMD_MACRO, '').trim();
  writeAutoRun(type, next);
  return [CMD_LABEL];
}

const SHELL_LABELS = { powershell: 'PowerShell', bash: 'Bash', zsh: 'Zsh', fish: 'Fish', cmd: 'Command Prompt (cmd.exe)' };

// Which shells can be set up here, and whether each already has the current wrapper.
function status() {
  const ids = process.platform === 'win32' ? ['powershell', 'bash', 'cmd'] : ['bash', 'zsh', 'fish'];
  return ids.map((id) => {
    let installed = false, upToDate = false;
    if (id === 'cmd') installed = upToDate = cmdInstalled();
    else {
      const re = new RegExp(`${MARK}[\\s\\S]*?${END}`);
      const block = `${MARK}\n${hooks[id]}\n${END}`;
      for (const f of rcFiles(id)) {
        let cur = ''; try { cur = fs.readFileSync(f, 'utf8'); } catch {}
        const m = re.exec(cur.replace(/\r\n/g, '\n'));
        if (m) { installed = true; upToDate = m[0] === block; }
      }
    }
    return { id, label: SHELL_LABELS[id], installed, upToDate };
  });
}

function install(shell) {
  if (shell === 'cmd') return installCmd();
  const body = hookFor(shell);
  const block = `${MARK}\n${body}\n${END}\n`;
  const done = [];
  for (const f of rcFiles(shell)) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    let cur = '';
    try { cur = fs.readFileSync(f, 'utf8'); } catch {}
    const re = new RegExp(`${MARK}[\\s\\S]*?${END}\\n?`);
    const next = re.test(cur) ? cur.replace(re, block) : cur + (cur && !cur.endsWith('\n') ? '\n' : '') + block;
    fs.writeFileSync(f, next);
    done.push(f);
  }
  return done;
}

function uninstall(shell) {
  if (shell === 'cmd') return uninstallCmd();
  const done = [];
  for (const f of rcFiles(shell)) {
    try {
      const cur = fs.readFileSync(f, 'utf8');
      const next = cur.replace(new RegExp(`${MARK}[\\s\\S]*?${END}\\n?`), '');
      if (next !== cur) { fs.writeFileSync(f, next); done.push(f); }
    } catch {}
  }
  return done;
}

module.exports = { detectShell, hookFor, envLine, install, uninstall, rcFiles, status };
