'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

process.env.CCACCOUNTS_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ccaccounts-'));
const core = require('../lib/core');
const shell = require('../lib/shell');
const ui = require('../lib/ui');

test('rejects unsafe names', () => {
  for (const n of ['', '.', '..', '../x', 'a/b', '-x', 'a b']) assert.equal(core.validName(n), false, n);
  assert.equal(core.validName('work-1.a_b'), true);
});

test('create, switch, list, remove', () => {
  core.createProfile('work');
  core.createProfile('personal');
  assert.equal(core.getActive(), 'work'); // first one becomes active
  fs.writeFileSync(path.join(core.profilePath('personal'), '.claude.json'),
    JSON.stringify({ oauthAccount: { emailAddress: 'me@example.com' } }));
  core.setActive('personal');
  const ps = core.listProfiles();
  assert.deepEqual(ps.map((p) => [p.name, p.active, p.email]), [['personal', true, 'me@example.com'], ['work', false, null]]);
  assert.throws(() => core.createProfile('work'), /already exists/);
  assert.throws(() => core.setActive('nope'), /No such/);
  core.removeProfile('personal');
  assert.equal(core.getActive(), ''); // stale pointer is ignored
  core.removeProfile('work');
});

test('work folder: validate, persist, fall back, track recents', () => {
  core.createProfile('wd');
  const d1 = fs.mkdtempSync(path.join(os.tmpdir(), 'wd1-'));
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'wd2-'));
  assert.equal(core.getWorkDir('wd'), '');
  assert.equal(core.launchDir('wd'), os.homedir());
  assert.equal(core.setWorkDir('wd', d1), d1);
  assert.equal(core.listProfiles().find((p) => p.name === 'wd').workDir, d1);
  assert.throws(() => core.setWorkDir('wd', path.join(d1, 'missing')), /not found/i);
  assert.throws(() => core.setWorkDir('wd', __filename), /Not a folder/);
  assert.throws(() => core.setWorkDir('nope', d1), /No such/);
  core.setWorkDir('wd', d2);
  assert.deepEqual(core.getRecent().slice(0, 2), [d2, d1]); // newest first
  core.setWorkDir('wd', d1);
  assert.deepEqual(core.getRecent().slice(0, 2), [d1, d2]); // reuse moves to the front, no duplicates
  fs.rmSync(d1, { recursive: true });
  assert.equal(core.launchDir('wd'), os.homedir()); // deleted folder falls back to home
  assert.ok(!core.getRecent().includes(d1));
  assert.equal(core.setWorkDir('wd', ''), ''); // blank clears
  assert.equal(core.getWorkDir('wd'), '');
  core.removeProfile('wd');
});

test('shared items: adopt, link, back up, unshare keeps a copy, delete spares the store', () => {
  const share = require('../lib/share');
  core.createProfile('sa'); core.createProfile('sb');
  const sa = core.profilePath('sa'), sb = core.profilePath('sb');
  fs.mkdirSync(path.join(sa, 'skills')); fs.writeFileSync(path.join(sa, 'skills', 'one.md'), 'one');
  fs.writeFileSync(path.join(sa, 'CLAUDE.md'), 'rules');
  fs.mkdirSync(path.join(sb, 'skills')); fs.writeFileSync(path.join(sb, 'skills', 'mine.md'), 'mine');

  share.setShared('sa', 'skills', true);   // sa's copy becomes the shared one
  share.setShared('sa', 'CLAUDE.md', true);
  assert.equal(share.status('sa').skills, true);
  assert.equal(fs.readFileSync(path.join(sa, 'skills', 'one.md'), 'utf8'), 'one');

  share.setShared('sb', 'skills', true);   // sb joins: its own skills are kept as a backup
  assert.equal(fs.readFileSync(path.join(sb, 'skills', 'one.md'), 'utf8'), 'one');
  const backup = fs.readdirSync(sb).find((f) => f.startsWith('skills.backup-'));
  assert.ok(backup && fs.existsSync(path.join(sb, backup, 'mine.md')));

  fs.writeFileSync(path.join(sa, 'skills', 'two.md'), 'two'); // edit through one account...
  assert.ok(fs.existsSync(path.join(sb, 'skills', 'two.md'))); // ...visible in the other

  share.setShared('sb', 'skills', false);  // unshare: private copy, shared store untouched
  assert.equal(share.status('sb').skills, false);
  assert.ok(fs.existsSync(path.join(sb, 'skills', 'two.md')));
  assert.ok(fs.existsSync(path.join(share.sharedRoot(), 'skills', 'two.md')));
  assert.throws(() => share.setShared('sb', 'nope', true), /Unknown item/);

  core.removeProfile('sa');                // deleting a linked account must not touch the store
  assert.ok(fs.existsSync(path.join(share.sharedRoot(), 'skills', 'one.md')));
  assert.equal(fs.readFileSync(path.join(share.sharedRoot(), 'CLAUDE.md'), 'utf8'), 'rules');
  core.removeProfile('sb');
});

test('folder bindings: deepest match wins, falls back to active, cleaned on remove', () => {
  core.createProfile('ba'); core.createProfile('bb');
  core.setActive('ba');
  const top = fs.mkdtempSync(path.join(os.tmpdir(), 'bind-'));
  const sub = path.join(top, 'client'); fs.mkdirSync(path.join(sub, 'deep'), { recursive: true });
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'bind2-'));
  core.bindFolder('bb', top);
  assert.deepEqual(core.resolveAccount(top), { name: 'bb', boundTo: top });
  assert.equal(core.resolveAccount(path.join(sub, 'deep')).name, 'bb');      // subfolders inherit
  assert.deepEqual(core.resolveAccount(other), { name: 'ba', boundTo: null }); // elsewhere: active
  assert.equal(core.resolveAccount(top + '-sibling').name, 'ba');             // prefix of a name is not a parent
  core.bindFolder('ba', sub);
  assert.equal(core.resolveAccount(path.join(sub, 'deep')).name, 'ba');       // deepest wins
  assert.equal(core.resolveAccount(top).name, 'bb');
  assert.throws(() => core.bindFolder('ba', path.join(top, 'missing')), /not found/i);
  assert.equal(core.unbindFolder(sub), true);
  assert.equal(core.unbindFolder(sub), false);
  core.removeProfile('bb');
  assert.equal(core.resolveAccount(top).name, 'ba'); // binding went with the account
  core.removeProfile('ba');
});

test('hooks exist for each shell, cmd is rejected', () => {
  for (const s of ['bash', 'zsh', 'fish', 'powershell']) assert.match(shell.hookFor(s), /CLAUDE_CONFIG_DIR/);
  assert.throws(() => shell.hookFor('cmd'), /cmd.exe/);
  assert.equal(shell.envLine('cmd', 'C:\\x'), 'set "CLAUDE_CONFIG_DIR=C:\\x"');
});

test('UI server enforces token + host, and switches accounts', async () => {
  core.createProfile('a'); core.createProfile('b');
  const { server, url } = await ui.start({ port: 0, open: false });
  const get = (p, headers = {}) => new Promise((res) => http.get(url + p, { headers }, (r) => {
    let s = ''; r.on('data', (c) => (s += c)); r.on('end', () => res({ code: r.statusCode, body: s }));
  }));
  const post = (p, body, token) => new Promise((res) => {
    const r = http.request(url + p, { method: 'POST', headers: { 'x-token': token } }, (x) => {
      let s = ''; x.on('data', (c) => (s += c)); x.on('end', () => res(x.statusCode));
    });
    r.end(JSON.stringify(body));
  });
  const page = await get('');
  assert.equal(page.code, 200);
  const token = /const TOKEN = "(\w+)"/.exec(page.body)[1];
  assert.equal((await get('api/state')).code, 401);
  assert.equal((await get('', { host: 'evil.com' })).code, 403);
  assert.equal(await post('api/use', { name: 'b' }, 'wrong'), 401);
  assert.equal(await post('api/use', { name: 'b' }, token), 200);
  assert.equal(core.getActive(), 'b');
  assert.equal(await post('api/use', { name: '../etc' }, token), 400);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdui-'));
  assert.equal(await post('api/workdir', { name: 'b', workDir: dir }, token), 200);
  assert.equal(core.getWorkDir('b'), dir);
  assert.equal(await post('api/workdir', { name: 'b', workDir: path.join(dir, 'nope') }, token), 400);
  assert.equal(await post('api/add', { name: 'bad', workDir: path.join(dir, 'nope') }, token), 400);
  assert.equal(core.exists('bad'), false); // failed add leaves no half-made account
  server.close();
});
