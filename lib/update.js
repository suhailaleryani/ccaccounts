'use strict';
// Self-update for the "Update" button. Works for a git clone (`git pull --ff-only`) and an npm install
// (`npm install -g ccaccounts@latest`). Nothing runs unless the button is pressed, and an update is only
// applied when it is safe (clean, fast-forward-able clone).
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const pkg = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));

// Only fixed arguments ever reach the shell (npm needs one on Windows because it is npm.cmd).
function run(cmd, args, { cwd, timeout = 120000 } = {}) {
  return new Promise((resolve) => {
    let out = '', err = '', done = false;
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    let c;
    try { c = spawn(cmd, args, { cwd, shell: cmd === 'npm', windowsHide: true }); }
    catch (e) { return resolve({ code: -1, stdout: '', stderr: e.message }); }
    const timer = setTimeout(() => { c.kill(); finish({ code: -1, stdout: out, stderr: err + '\nTimed out' }); }, timeout);
    c.stdout.on('data', (d) => (out += d)); c.stderr.on('data', (d) => (err += d));
    c.on('error', (e) => finish({ code: -1, stdout: out, stderr: e.message }));
    c.on('close', (code) => finish({ code: code == null ? -1 : code, stdout: out, stderr: err }));
  });
}

function detectInstall(dir = ROOT) {
  if (fs.existsSync(path.join(dir, '.git'))) return 'git';
  if (dir.split(path.sep).includes('node_modules')) return 'npm';
  return 'unknown';
}

// Numeric dotted compare (1.2.10 > 1.2.9); a pre-release suffix is ignored.
function compareVersions(a, b) {
  const n = (v) => String(v).split('-')[0].split('.').map((x) => parseInt(x, 10) || 0);
  const x = n(a), y = n(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

const tail = (s, n = 600) => (s.length > n ? '…' + s.slice(-n) : s).trim();

async function checkGit(dir, current, r) {
  const g = (...a) => r('git', a, { cwd: dir });
  const f = await g('fetch', '--quiet');
  if (f.code !== 0) return { status: 'error', message: `Could not reach the remote: ${tail(f.stderr, 200) || 'git fetch failed'}` };
  const up = await g('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}');
  if (up.code !== 0) return { status: 'error', message: 'This clone has no upstream branch to update from.' };
  const behind = parseInt((await g('rev-list', '--count', 'HEAD..@{u}')).stdout, 10) || 0;
  const ahead = parseInt((await g('rev-list', '--count', '@{u}..HEAD')).stdout, 10) || 0;
  const dirty = !!(await g('status', '--porcelain', '--untracked-files=no')).stdout.trim();
  if (!behind) {
    return { status: 'current', message: `You are up to date (v${current}).` + (ahead ? ` You have ${ahead} local commit${ahead > 1 ? 's' : ''} not pushed.` : '') };
  }
  const subject = (await g('log', '-1', '--format=%s', '@{u}')).stdout.trim();
  const blocker = dirty ? 'You have uncommitted changes in this clone; commit or stash them first.'
    : ahead ? `You have ${ahead} local commit${ahead > 1 ? 's' : ''} that are not on the remote, so it can't fast-forward. Update by hand.` : '';
  return { status: 'available', message: `${behind} new commit${behind > 1 ? 's' : ''} available. Latest: "${subject}".`,
           canUpdate: !blocker, blocker, command: 'git pull --ff-only', behind };
}

async function checkNpm(dir, current, r) {
  const name = pkg(dir).name;
  const v = await r('npm', ['view', name, 'version']);
  if (v.code !== 0) {
    return /E404|not found/i.test(v.stderr + v.stdout)
      ? { status: 'unpublished', message: `${name} isn't published on npm yet, so there is nothing to update to.` }
      : { status: 'error', message: `Could not reach npm: ${tail(v.stderr, 200) || 'npm view failed'}` };
  }
  const latest = v.stdout.trim().split('\n').pop().trim();
  if (compareVersions(current, latest) >= 0) return { status: 'current', message: `You are up to date (v${current}).`, latest };
  return { status: 'available', message: `Version ${latest} is available (you have ${current}).`, latest, canUpdate: true, blocker: '',
           command: `npm install -g ${name}@latest` };
}

async function checkUpdate({ dir = ROOT, runner = run } = {}) {
  const type = detectInstall(dir), current = pkg(dir).version;
  const base = { type, current, canUpdate: false, blocker: '', command: '' };
  if (type === 'git') return { ...base, ...(await checkGit(dir, current, runner)) };
  if (type === 'npm') return { ...base, ...(await checkNpm(dir, current, runner)) };
  return { ...base, status: 'unsupported', message: 'Could not tell how ccaccounts was installed, so it cannot update itself.' };
}

// Re-checks first, so a stale dialog can never apply an update that is no longer safe.
async function applyUpdate({ dir = ROOT, runner = run } = {}) {
  const c = await checkUpdate({ dir, runner });
  if (c.status !== 'available' || !c.canUpdate) return { ok: false, message: c.blocker || c.message, from: c.current };
  const r = c.type === 'git' ? await runner('git', ['pull', '--ff-only'], { cwd: dir })
    : await runner('npm', ['install', '-g', `${pkg(dir).name}@latest`], { timeout: 300000 });
  const output = tail(r.stdout + r.stderr);
  if (r.code !== 0) return { ok: false, message: `The update command failed (exit ${r.code}).`, output, from: c.current };
  let to = c.latest || ''; try { to = pkg(dir).version; } catch {}
  return { ok: true, message: 'Updated. Restart ccaccounts (close this window and open it again) to use the new version.', output, from: c.current, to };
}

module.exports = { checkUpdate, applyUpdate, detectInstall, compareVersions, run, ROOT };
