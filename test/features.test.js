'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

process.env.CCACCOUNTS_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ccaccounts-feat-'));
const core = require('../lib/core');
const sessions = require('../lib/sessions');
const terminal = require('../lib/terminal');
const icon = require('../lib/icon');
const app = require('../lib/app');
const ui = require('../lib/ui');

test('settings: validate each key, merge, clear', () => {
  core.createProfile('s1');
  assert.deepEqual(core.getSettings('s1'), { workDir: '', note: '', color: '', args: '', terminal: '' });
  core.updateSettings('s1', { note: 'client A\nbilled', color: '#4f7cac', args: '--model opus', terminal: 'powershell' });
  const s = core.getSettings('s1');
  assert.equal(s.note, 'client A billed'); // newlines flattened
  assert.equal(s.color, '#4f7cac'); assert.equal(s.args, '--model opus'); assert.equal(s.terminal, 'powershell');
  core.updateSettings('s1', { note: 'x' }); // other keys untouched
  assert.equal(core.getSettings('s1').color, '#4f7cac');
  core.updateSettings('s1', { color: '' });
  assert.equal(core.getSettings('s1').color, '');
  for (const bad of [{ color: 'red' }, { args: '--x; rm -rf /' }, { args: '& calc' }, { args: '"quoted"' },
                     { terminal: 'bash' }, { nope: 'x' }]) assert.throws(() => core.updateSettings('s1', bad), undefined, JSON.stringify(bad));
  assert.throws(() => core.updateSettings('missing', { note: 'x' }), /No such/);
  core.removeProfile('s1');
});

test('health: plan and login expiry come from the credentials file', () => {
  core.createProfile('h1'); core.createProfile('h2'); core.createProfile('h3');
  const write = (n, o) => fs.writeFileSync(path.join(core.profilePath(n), '.credentials.json'), JSON.stringify({ claudeAiOauth: o }));
  const future = Date.now() + 86400000, past = Date.now() - 86400000;
  write('h1', { accessToken: 'a', refreshToken: 'r', expiresAt: past, refreshTokenExpiresAt: future, subscriptionType: 'max' });
  write('h2', { accessToken: 'a', refreshToken: 'r', expiresAt: past, refreshTokenExpiresAt: past });
  write('h3', { accessToken: 'a', expiresAt: past }); // no refresh token at all
  const by = Object.fromEntries(core.listProfiles().map((p) => [p.name, p]));
  assert.equal(by.h1.plan, 'max'); assert.equal(by.h1.loginExpired, false); // expired access token alone is normal
  assert.equal(by.h2.loginExpired, true);
  assert.equal(by.h3.loginExpired, true);
  assert.ok(!JSON.stringify(by).includes('"accessToken"')); // tokens never leave core
  for (const n of ['h1', 'h2', 'h3']) core.removeProfile(n);
});

test('sessions: newest first, real prompt as title, skips agent/meta files', () => {
  core.createProfile('se');
  const dir = path.join(core.profilePath('se'), 'projects', 'D--proj'); fs.mkdirSync(dir, { recursive: true });
  const id = (n) => `0000000${n}-0000-4000-8000-000000000000`;
  const line = (o) => JSON.stringify(o) + '\n';
  const mk = (file, body, age) => { const f = path.join(dir, file); fs.writeFileSync(f, body); const t = new Date(Date.now() - age); fs.utimesSync(f, t, t); };
  mk(`${id(1)}.jsonl`, line({ type: 'mode' }) + line({ type: 'user', isMeta: true, cwd: 'D:\\proj', message: { content: 'meta' } }) +
    line({ type: 'user', cwd: 'D:\\proj', message: { content: '<command-name>/x</command-name>' } }) +
    line({ type: 'user', cwd: 'D:\\proj', message: { content: [{ type: 'text', text: 'fix the   login bug' }] } }), 5000);
  mk(`${id(2)}.jsonl`, line({ type: 'user', cwd: 'D:\\other', message: { content: 'newer one' } }), 1000);
  mk(`${id(3)}.jsonl`, line({ type: 'mode' }), 500); // nothing usable
  mk('agent-abc.jsonl', line({ type: 'user', cwd: 'D:\\x', message: { content: 'sub agent' } }), 100);
  const list = sessions.listSessions('se');
  assert.deepEqual(list.map((s) => [s.id, s.title, s.cwd]), [
    [id(2), 'newer one', 'D:\\other'], [id(1), 'fix the login bug', 'D:\\proj']]);
  assert.deepEqual(sessions.listSessions('se', 1).map((s) => s.id), [id(2)]);
  core.removeProfile('se');
});

test('windows launcher scripts: cmd, powershell, Windows Terminal', () => {
  core.createProfile('w1');
  const scripts = path.join(os.tmpdir(), 'launch');
  const cmd = terminal.buildWin('w1', 'D:\\My 100% Proj', '--model opus', '', scripts);
  assert.match(cmd.content, /cd \/d "D:\\My 100%% Proj"/); // % doubled for batch files
  assert.match(cmd.content, /set "CLAUDE_CONFIG_DIR=.*w1"/); assert.match(cmd.content, /claude --model opus\r\n$/);
  assert.deepEqual(cmd.args.slice(0, 5), ['/d', '/c', 'start', '', 'cmd']);
  const ps = terminal.buildWin('w1', "D:\\it's", '', 'powershell', scripts);
  assert.match(ps.content, /Set-Location -LiteralPath 'D:\\it''s'/); assert.ok(ps.file.endsWith('w1.ps1'));
  const wt = terminal.buildWin('w1', 'D:\\p', '', 'wt', scripts);
  assert.equal(wt.exe, 'wt.exe'); assert.deepEqual(wt.args.slice(0, 2), ['-d', 'D:\\p']);
  core.removeProfile('w1');
});

test('icon: valid PNG and ICO', () => {
  const p = icon.png(32);
  assert.deepEqual([...p.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(p.readUInt32BE(16), 32);
  const i = icon.ico([32, 16]);
  assert.equal(i.readUInt16LE(2), 1); assert.equal(i.readUInt16LE(4), 2); // type icon, 2 images
  const off = i.readUInt32LE(6 + 12), len = i.readUInt32LE(6 + 8);
  assert.equal(i.subarray(off, off + 4).toString('latin1', 1, 4), 'PNG');
  assert.equal(off + len + (i.readUInt32LE(22 + 8)), i.length); // entries tile the file
});

test('app launchers: desktop entry and launch agent', () => {
  assert.match(app.desktopEntry(), /^\[Desktop Entry\]\nType=Application/);
  assert.match(app.desktopEntry(), /Exec=".*node.*" ".*ccaccounts\.js" app/);
  assert.match(app.launchAgentPlist(), /<key>RunAtLoad<\/key><true\/>/);
  assert.match(app.launchAgentPlist(), /<string>app<\/string>/);
  process.env.CCACCOUNTS_BROWSER = 'C:\\x\\browser.exe';
  assert.equal(app.findAppBrowser(), 'C:\\x\\browser.exe');
  delete process.env.CCACCOUNTS_BROWSER;
});

test('UI API: settings, sessions, resume validation, favicon', async () => {
  core.createProfile('u1');
  const { server, url } = await ui.start({ port: 0, open: false });
  const raw = (p, opts = {}, body) => new Promise((res) => {
    const r = http.request(url + p, opts, (x) => { let s = ''; x.on('data', (c) => (s += c)); x.on('end', () => res({ code: x.statusCode, type: x.headers['content-type'], body: s })); });
    r.end(body);
  });
  const token = /const TOKEN = "(\w+)"/.exec((await raw('')).body)[1];
  const post = (p, b) => raw(p, { method: 'POST', headers: { 'x-token': token } }, JSON.stringify(b));
  assert.equal((await raw('favicon.png')).type, 'image/png');
  assert.equal((await post('api/settings', { name: 'u1', settings: { note: 'hi', color: '#c96442' } })).code, 200);
  assert.equal(core.getSettings('u1').note, 'hi');
  assert.equal((await post('api/settings', { name: 'u1', settings: { args: 'a; b' } })).code, 400);
  assert.deepEqual(JSON.parse((await post('api/sessions', { name: 'u1' })).body), { sessions: [] });
  assert.equal((await post('api/resume', { name: 'u1', id: '../../x', cwd: os.tmpdir() })).code, 400); // id must be a UUID
  const st = JSON.parse((await raw('api/state', { headers: { 'x-token': token } })).body);
  assert.equal(st.profiles[0].note, 'hi'); assert.equal(typeof st.win, 'boolean');
  server.close();
  core.removeProfile('u1');
});
