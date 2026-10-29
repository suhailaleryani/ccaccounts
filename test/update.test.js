'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const update = require('../lib/update');

const git = (cwd, ...a) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.io', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const setVersion = (dir, v) => fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'ccaccounts', version: v }));

test('compareVersions: numeric, not lexical', () => {
  const c = update.compareVersions;
  assert.equal(c('1.2.10', '1.2.9'), 1);
  assert.equal(c('1.0.0', '1.0.0'), 0);
  assert.equal(c('1.9', '1.10'), -1);
  assert.equal(c('2.0.0-beta.1', '2.0.0'), 0); // pre-release suffix ignored
  assert.equal(c('1.0', '1.0.1'), -1);
});

test('detectInstall: git clone, npm global, unknown', () => {
  const g = tmp('upd-g-'); fs.mkdirSync(path.join(g, '.git'));
  assert.equal(update.detectInstall(g), 'git');
  const n = path.join(tmp('upd-n-'), 'node_modules', 'ccaccounts'); fs.mkdirSync(n, { recursive: true });
  assert.equal(update.detectInstall(n), 'npm');
  assert.equal(update.detectInstall(tmp('upd-u-')), 'unknown');
});

test('git clone: up to date, behind, blocked by local changes, then fast-forwards', async () => {
  const root = tmp('upd-git-');
  const origin = path.join(root, 'origin.git'), work = path.join(root, 'work'), mine = path.join(root, 'mine');
  git(root, 'init', '--bare', '-b', 'main', origin);
  git(root, 'clone', origin, work);
  setVersion(work, '1.0.0'); git(work, 'add', '.'); git(work, 'commit', '-m', 'v1'); git(work, 'push', '-u', 'origin', 'HEAD:main');
  git(root, 'clone', origin, mine); // the "installed" copy

  let c = await update.checkUpdate({ dir: mine });
  assert.equal(c.type, 'git'); assert.equal(c.status, 'current'); assert.equal(c.current, '1.0.0');

  setVersion(work, '1.1.0'); git(work, 'commit', '-am', 'Add a shiny feature'); git(work, 'push', 'origin', 'HEAD:main');
  c = await update.checkUpdate({ dir: mine });
  assert.equal(c.status, 'available'); assert.equal(c.canUpdate, true); assert.equal(c.command, 'git pull --ff-only');
  assert.match(c.message, /1 new commit.*Add a shiny feature/);

  fs.appendFileSync(path.join(mine, 'package.json'), ' '); // dirty tracked file
  c = await update.checkUpdate({ dir: mine });
  assert.equal(c.canUpdate, false); assert.match(c.blocker, /uncommitted/);
  const refused = await update.applyUpdate({ dir: mine });
  assert.equal(refused.ok, false); assert.equal(JSON.parse(fs.readFileSync(path.join(mine, 'package.json'), 'utf8').trim()).version, '1.0.0'); // untouched
  git(mine, 'checkout', '--', 'package.json');

  const done = await update.applyUpdate({ dir: mine });
  assert.equal(done.ok, true, done.message); assert.equal(done.from, '1.0.0'); assert.equal(done.to, '1.1.0');
  assert.equal((await update.checkUpdate({ dir: mine })).status, 'current');
});

test('git clone with unpushed local commits is not fast-forwarded', async () => {
  const root = tmp('upd-ahead-');
  const origin = path.join(root, 'o.git'), a = path.join(root, 'a'), b = path.join(root, 'b');
  git(root, 'init', '--bare', '-b', 'main', origin); git(root, 'clone', origin, a);
  setVersion(a, '1.0.0'); git(a, 'add', '.'); git(a, 'commit', '-m', 'v1'); git(a, 'push', '-u', 'origin', 'HEAD:main');
  git(root, 'clone', origin, b);
  fs.writeFileSync(path.join(a, 'x.txt'), '1'); git(a, 'add', '.'); git(a, 'commit', '-m', 'remote change'); git(a, 'push', 'origin', 'HEAD:main');
  fs.writeFileSync(path.join(b, 'y.txt'), '1'); git(b, 'add', '.'); git(b, 'commit', '-m', 'local only');
  const c = await update.checkUpdate({ dir: b });
  assert.equal(c.status, 'available'); assert.equal(c.canUpdate, false); assert.match(c.blocker, /not on the remote/);
});

test('npm install: newer, current, unpublished, offline (runner is mocked)', async () => {
  const dir = path.join(tmp('upd-npm-'), 'node_modules', 'ccaccounts'); fs.mkdirSync(dir, { recursive: true }); setVersion(dir, '1.2.9');
  const calls = [];
  const fake = (out) => async (cmd, args) => { calls.push([cmd, ...args].join(' ')); return typeof out === 'function' ? out(cmd, args) : out; };

  let c = await update.checkUpdate({ dir, runner: fake({ code: 0, stdout: '1.2.10\n', stderr: '' }) });
  assert.equal(c.status, 'available'); assert.equal(c.latest, '1.2.10'); assert.equal(c.command, 'npm install -g ccaccounts@latest');
  assert.equal((await update.checkUpdate({ dir, runner: fake({ code: 0, stdout: '1.2.9\n', stderr: '' }) })).status, 'current');
  assert.equal((await update.checkUpdate({ dir, runner: fake({ code: 1, stdout: '', stderr: 'npm error code E404' }) })).status, 'unpublished');
  c = await update.checkUpdate({ dir, runner: fake({ code: 1, stdout: '', stderr: 'getaddrinfo ENOTFOUND registry.npmjs.org' }) });
  assert.equal(c.status, 'error'); assert.match(c.message, /Could not reach npm/);

  calls.length = 0; // apply: re-checks, then runs exactly the fixed install command
  const r = await update.applyUpdate({ dir, runner: fake((cmd, args) => args[0] === 'view' ? { code: 0, stdout: '1.3.0', stderr: '' } : { code: 0, stdout: 'added 1 package', stderr: '' }) });
  assert.equal(r.ok, true); assert.deepEqual(calls, ['npm view ccaccounts version', 'npm install -g ccaccounts@latest']);
  const bad = await update.applyUpdate({ dir, runner: fake((cmd, args) => args[0] === 'view' ? { code: 0, stdout: '1.3.0', stderr: '' } : { code: 1, stdout: '', stderr: 'EACCES' }) });
  assert.equal(bad.ok, false); assert.match(bad.output, /EACCES/);
  const none = await update.applyUpdate({ dir, runner: fake({ code: 0, stdout: '1.2.9', stderr: '' }) });
  assert.equal(none.ok, false); // nothing to apply
});

test('installed from GitHub (not on npm): updates from the repo main branch', async () => {
  const dir = path.join(tmp('upd-gh-'), 'node_modules', 'ccaccounts'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'ccaccounts', version: '1.0.0',
    repository: { type: 'git', url: 'git+https://github.com/suhailaleryani/ccaccounts.git' } }));
  assert.equal(update.githubRepo(dir), 'suhailaleryani/ccaccounts');
  const e404 = async () => ({ code: 1, stdout: '', stderr: 'npm error code E404' });
  const urls = [];
  const remote = (v) => async (url) => { urls.push(url); return v == null ? null : JSON.stringify({ version: v }); };

  let c = await update.checkUpdate({ dir, runner: e404, fetcher: remote('1.1.0') });
  assert.equal(c.status, 'available'); assert.equal(c.command, 'npm install -g github:suhailaleryani/ccaccounts'); assert.equal(c.canUpdate, true);
  assert.deepEqual(urls, ['https://raw.githubusercontent.com/suhailaleryani/ccaccounts/main/package.json']);
  assert.equal((await update.checkUpdate({ dir, runner: e404, fetcher: remote('1.0.0') })).status, 'current');
  assert.equal((await update.checkUpdate({ dir, runner: e404, fetcher: remote(null) })).status, 'error'); // offline / blocked

  const calls = [];
  const r = await update.applyUpdate({ dir, fetcher: remote('1.1.0'),
    runner: async (cmd, args) => { calls.push([cmd, ...args].join(' ')); return cmd === 'npm' && args[0] === 'view' ? { code: 1, stdout: '', stderr: 'E404' } : { code: 0, stdout: 'ok', stderr: '' }; } });
  assert.equal(r.ok, true); assert.deepEqual(calls, ['npm view ccaccounts version', 'npm install -g github:suhailaleryani/ccaccounts']);

  // only plain GitHub repos are trusted as an update source
  const other = tmp('upd-other-'); fs.writeFileSync(path.join(other, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0', repository: { url: 'https://evil.example/a/b.git' } }));
  assert.equal(update.githubRepo(other), '');
});

test('findGit: PATH wins; run() still finds git when the process PATH is empty or stale', async () => {
  // a git on PATH is preferred (a stand-in file is enough: we only look it up)
  const bin = tmp('upd-bin-'), name = process.platform === 'win32' ? 'git.exe' : 'git';
  fs.writeFileSync(path.join(bin, name), '');
  assert.equal(update.findGit({ PATH: bin, Path: bin }), path.join(bin, name));

  // the real-world failure: the app was started from a shortcut whose PATH has no git ("spawn git ENOENT")
  assert.ok(update.findGit(), 'these tests need git installed in a standard place');
  const key = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') || 'PATH';
  const old = process.env[key];
  process.env[key] = '';
  try {
    const r = await update.run('git', ['--version']);
    assert.equal(r.code, 0, r.stderr); assert.match(r.stdout, /git version/);
  } finally { process.env[key] = old; }
});

test('unknown install cannot update itself', async () => {
  const dir = tmp('upd-unk-'); setVersion(dir, '1.0.0');
  const c = await update.checkUpdate({ dir, runner: async () => { throw new Error('must not run anything'); } });
  assert.equal(c.status, 'unsupported'); assert.equal(c.canUpdate, false);
});
