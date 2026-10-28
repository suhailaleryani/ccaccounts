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

test('activity: dedupes streamed replies, sums per local day, caches per file', async () => {
  const activity = require('../lib/activity');
  core.createProfile('ac');
  const dir = path.join(core.profilePath('ac'), 'projects', 'p'); fs.mkdirSync(dir, { recursive: true });
  const now = Date.now(), at = (hoursAgo) => new Date(now - hoursAgo * 3600000).toISOString();
  const line = (id, ts, out, model = 'claude-opus-5') => JSON.stringify({ type: 'assistant', timestamp: ts,
    message: { id, model, usage: { input_tokens: 10, output_tokens: out, cache_creation_input_tokens: 5, cache_read_input_tokens: 99999 } } }) + '\n';
  const log = path.join(dir, 'a.jsonl');
  fs.writeFileSync(log,
    line('m1', at(1), 5) + line('m1', at(1), 50) +          // same reply streamed twice: counts once, final usage wins
    line('m2', at(2), 20, 'claude-sonnet-5-5') +
    line('m3', at(60), 30) +                                  // ~2.5 days ago
    line('old', at(24 * 30), 1) +                             // outside the window
    JSON.stringify({ type: 'user', message: { content: 'x' } }) + '\n');
  const a = await activity.activity('ac', 7, now);
  assert.equal(a.days.length, 7);
  assert.equal(a.replies, 3);
  assert.equal(a.tokens, (10 + 50 + 5) + (10 + 20 + 5) + (10 + 30 + 5)); // cache reads excluded
  assert.equal(a.topModel, 'claude-opus-5');
  assert.equal(a.days[6].date, activity.dayKey(new Date(now)));
  assert.ok(a.days.slice(0, 3).every((d) => d.replies === 0)); // quiet days are zero-filled
  assert.ok(fs.existsSync(path.join(core.root(), 'activity-cache.json')));
  fs.writeFileSync(log, 'not json at all\n'); fs.utimesSync(log, new Date(now - 1000), new Date(now - 1000)); // changed file: re-read, not stale
  assert.equal((await activity.activity('ac', 7, now)).replies, 0);
  await assert.rejects(activity.activity('nope'), /No such/);
  core.removeProfile('ac');
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

test('ask prompt: parse answers, skip non-interactive runs, abort cleanly', async () => {
  const { PassThrough } = require('stream');
  const pick = require('../lib/pick');
  const ps = [{ name: 'work', email: 'w@x.io' }, { name: 'Personal', email: null }];
  assert.equal(pick.parseAnswer('', ps, 'work'), 'work');          // Enter = default
  assert.equal(pick.parseAnswer('2', ps, 'work'), 'Personal');
  assert.equal(pick.parseAnswer('personal', ps, 'work'), 'Personal'); // name, any case
  assert.equal(pick.parseAnswer('3', ps, 'work'), null);
  assert.equal(pick.parseAnswer('zzz', ps, 'work'), null);
  for (const a of [['-p', 'hi'], ['--version'], ['mcp', 'list'], ['config', 'get'], ['update']]) assert.equal(pick.isInteractiveRun(a), false, a.join(' '));
  for (const a of [[], ['fix the bug'], ['--resume', 'x'], ['--model', 'opus']]) assert.equal(pick.isInteractiveRun(a), true, a.join(' '));

  const run = (typed) => { const input = new PassThrough(), output = new PassThrough(); let text = '';
    output.on('data', (c) => (text += c)); const p = pick.choose(ps, 'work', { input, output }); input.write(typed); return p.then((r) => [r, text]); };
  const [r1, shown] = await run('2\n');
  assert.equal(r1, 'Personal'); assert.match(shown, /1\) work  w@x\.io   \(default\)/); assert.match(shown, /2\) Personal/);
  assert.equal((await run('\n'))[0], 'work');
  assert.equal((await run('9\nx\ny\n'))[0], null);                  // three bad answers give up
  const input = new PassThrough(), output = new PassThrough(); const p = pick.choose(ps, 'work', { input, output }); input.end();
  assert.equal(await p, null);                                       // Ctrl+D / closed input

  core.setConfig({ askProfile: true }); assert.equal(core.getConfig().askProfile, true);
  core.setConfig({ askProfile: false }); assert.equal(core.getConfig().askProfile, false);
  const shell = require('../lib/shell');
  for (const s of ['bash', 'zsh', 'fish', 'powershell']) assert.match(shell.hookFor(s), /130/, s); // wrappers honour "cancelled"
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
  assert.equal((await post('api/sessions', { name: 'u1', limit: 9999 })).code, 200); // limit is clamped, not an error
  const act = JSON.parse((await post('api/activity', { name: 'u1' })).body);
  assert.equal(act.days.length, 7); assert.equal(act.replies, 0);
  assert.equal((await post('api/resume', { name: 'u1', id: '../../x', cwd: os.tmpdir() })).code, 400); // id must be a UUID
  const st = JSON.parse((await raw('api/state', { headers: { 'x-token': token } })).body);
  assert.equal(st.profiles[0].note, 'hi'); assert.equal(typeof st.win, 'boolean');
  server.close();
  core.removeProfile('u1');
});
