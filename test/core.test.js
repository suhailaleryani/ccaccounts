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
  server.close();
});
