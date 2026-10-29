'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

process.env.CCACCOUNTS_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ccaccounts-lan-'));
const core = require('../lib/core');
const lan = require('../lib/lan');
const qr = require('../lib/qr');
const ui = require('../lib/ui');

test('lan: which addresses count as private, and who is let in', () => {
  for (const ip of ['10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.1.20', '169.254.1.1', '100.64.0.9', '::ffff:192.168.1.5'])
    assert.equal(lan.isPrivate(ip), true, ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '11.0.0.1', '::1', 'fe80::1', '', 'nope'])
    assert.equal(lan.isPrivate(ip), false, ip);
  const own = ['192.168.1.10'];
  const c = (remoteAddress, host, on = true) => lan.classify({ remoteAddress, host, lan: on, own });
  assert.equal(c('127.0.0.1', 'localhost:4455'), 'local');
  assert.equal(c('::1', '127.0.0.1:4455'), 'local');
  assert.equal(c('127.0.0.1', 'evil.example:4455'), null);            // DNS rebinding against localhost
  assert.equal(c('192.168.1.55', '192.168.1.10:4455'), 'remote');
  assert.equal(c('::ffff:192.168.1.55', '192.168.1.10'), 'remote');
  assert.equal(c('192.168.1.55', 'localhost:4455'), null);            // a LAN client cannot claim to be local via Host
  assert.equal(c('192.168.1.55', 'evil.example'), null);
  assert.equal(c('192.168.1.55', '192.168.1.10:4455', false), null);  // lan off: nobody remote
  assert.equal(c('8.8.8.8', '192.168.1.10:4455'), null);               // public address never served
});

test('lan: real Wi-Fi/Ethernet is offered before VPN overlays and virtual adapters', () => {
  const f = (name, address) => ({ [name]: [{ family: 'IPv4', internal: false, address }] });
  const ifs = { ...f('vEthernet (Default Switch)', '172.31.176.1'), ...f('Ethernet 4', '192.168.56.1'), ...f('Tailscale', '100.101.1.1'),
                ...f('eth0', '10.0.0.5'), ...f('Wi-Fi', '192.168.0.109'), lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
                pub: [{ family: 'IPv4', internal: false, address: '8.8.4.4' }], v6: [{ family: 'IPv6', internal: false, address: 'fd00::1' }] };
  assert.deepEqual(lan.lanInterfaces(ifs).map((i) => i.address), ['192.168.0.109', '10.0.0.5', '100.101.1.1', '172.31.176.1', '192.168.56.1']);
  assert.deepEqual(lan.lanAddresses({}), []);
});

test('lan: pairing code works once, expires, and can be revoked', () => {
  let t = 1000; const p = lan.pairing(() => t);
  const { code } = p.newCode();
  const sid = p.redeem(code);
  assert.ok(sid && p.valid(sid));
  assert.equal(p.redeem(code), null);                                  // single use
  assert.equal(p.valid('forged'), false);
  const { code: c2 } = p.newCode(); t += lan.PAIR_TTL + 1;
  assert.equal(p.redeem(c2), null);                                    // expired
  assert.equal(p.count(), 1); assert.equal(p.revokeAll(), 1); assert.equal(p.valid(sid), false);
  assert.deepEqual(lan.parseCookies('a=1; cca_session=abc; b=c=d'), { a: '1', cca_session: 'abc', b: 'c=d' });
});

test('qr: structure of the encoded matrix', () => {
  const m = qr.encode('http://192.168.1.10:4455/pair?code=' + 'a'.repeat(32), 'M');
  assert.equal(m.length, m[0].length); assert.equal((m.length - 17) % 4, 0);
  const finder = (x, y) => { for (let d = 0; d < 7; d++) for (const [a, b] of [[x + d, y], [x + d, y + 6], [x, y + d], [x + 6, y + d]]) if (!m[b][a]) return false; return m[y + 3][x + 3]; };
  assert.ok(finder(0, 0) && finder(m.length - 7, 0) && finder(0, m.length - 7));
  assert.equal(qr.toRows(qr.encode('a', 'L')).length, 21);             // version 1
  assert.throws(() => qr.encode('x'.repeat(500)), /too long/);
  assert.match(qr.toTerminal(m), /█|▀|▄/);
});

const ownIp = lan.lanAddresses()[0];
const request = (host, port, method, url, { headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const r = http.request({ host, port, method, path: url, headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) } }, (res) => {
    let s = ''; res.on('data', (c) => (s += c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: s }));
  });
  r.on('error', reject); r.end(body ? JSON.stringify(body) : undefined);
});
const tokenOf = (html) => /const TOKEN = "([0-9a-f]+)"/.exec(html)[1];

test('lan off: the server is not reachable on the network and /api/pair says so', async () => {
  const { server, url } = await ui.start({ port: 0, open: false });
  const port = server.address().port;
  const local = await request('127.0.0.1', port, 'GET', '/');
  const token = tokenOf(local.body);
  const r = await request('127.0.0.1', port, 'POST', '/api/pair', { headers: { 'x-token': token, host: '127.0.0.1:' + port }, body: {} });
  assert.equal(r.status, 400); assert.match(r.body, /Phone access is off/);
  if (ownIp) await assert.rejects(request(ownIp, port, 'GET', '/'), /ECONNREFUSED/); // bound to loopback only
  await new Promise((r2) => server.close(r2));
});

test('lan on: pair, switch account from the "phone", everything else refused', { skip: !ownIp && 'no private network address on this machine' }, async () => {
  core.createProfile('work'); core.createProfile('home');
  const { server, makePair } = await ui.start({ port: 0, open: false, lan: true });
  const port = server.address().port;
  try {
    // Unpaired phone: nothing but the help page.
    assert.equal((await request(ownIp, port, 'GET', '/')).status, 401);
    assert.equal((await request(ownIp, port, 'GET', '/api/state')).status, 401);
    // Host header spoofing from the LAN does not make a client local.
    assert.equal((await request(ownIp, port, 'GET', '/', { headers: { host: 'localhost:' + port } })).status, 403);
    assert.equal((await request(ownIp, port, 'GET', '/', { headers: { host: 'evil.example' } })).status, 403);
    // Bad and used codes.
    assert.equal((await request(ownIp, port, 'GET', '/pair?code=nope')).status, 403);

    const pair = makePair();
    assert.equal(pair.address, ownIp);
    assert.ok(pair.url.startsWith(`http://${ownIp}:${port}/pair?code=`));
    assert.ok(pair.networks.length >= 1 && pair.rows.length > 20);
    const code = new URL(pair.url).searchParams.get('code');
    const paired = await request(ownIp, port, 'GET', '/pair?code=' + code);
    assert.equal(paired.status, 302);
    const cookie = paired.headers['set-cookie'][0];
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
    assert.equal((await request(ownIp, port, 'GET', '/pair?code=' + code)).status, 403); // single use

    const h = { cookie: cookie.split(';')[0] };
    const page = await request(ownIp, port, 'GET', '/', { headers: h });
    assert.equal(page.status, 200);
    const th = { ...h, 'x-token': tokenOf(page.body) };
    // The cookie alone is not enough for the API (token needed too).
    assert.equal((await request(ownIp, port, 'GET', '/api/state', { headers: h })).status, 401);
    const state = JSON.parse((await request(ownIp, port, 'GET', '/api/state', { headers: th })).body);
    assert.equal(state.remote, true); assert.equal(state.lan, true);
    // Allowed: switch.
    const sw = await request(ownIp, port, 'POST', '/api/use', { headers: th, body: { name: 'home' } });
    assert.equal(sw.status, 200); assert.equal(core.getActive(), 'home');
    // Refused from a phone: anything that opens things, edits things, or makes new pairing codes.
    for (const u of ['/api/lan', '/api/open', '/api/add', '/api/remove', '/api/settings', '/api/pair', '/api/unpair', '/api/signin', '/api/cli-save', '/api/update-apply', '/api/resume', '/api/sessions'])
      assert.equal((await request(ownIp, port, 'POST', u, { headers: th, body: { name: 'work' } })).status, 403, u);
    assert.equal(core.exists('work'), true);

    // The computer can disconnect phones; the old session stops working.
    const lt = tokenOf((await request('127.0.0.1', port, 'GET', '/')).body);
    const un = await request('127.0.0.1', port, 'POST', '/api/unpair', { headers: { 'x-token': lt, host: '127.0.0.1:' + port }, body: {} });
    assert.equal(JSON.parse(un.body).revoked, 1);
    assert.equal((await request(ownIp, port, 'GET', '/api/state', { headers: th })).status, 401);
  } finally { await new Promise((r) => server.close(r)); }
});

test('lan: turned on and off from the running UI, and off drops paired phones', { skip: !ownIp && 'no private network address on this machine' }, async () => {
  const { server } = await ui.start({ port: 0, open: false });            // started WITHOUT --lan
  const port = server.address().port, lh = { host: '127.0.0.1:' + port };
  const local = async (url, body) => request('127.0.0.1', port, 'POST', url, { headers: { 'x-token': tokenOf((await request('127.0.0.1', port, 'GET', '/')).body), ...lh }, body });
  try {
    assert.equal(JSON.parse((await local('/api/lan', { on: true })).body).lan, true);
    const pair = JSON.parse((await local('/api/pair', {})).body);
    const lanPort = Number(new URL(pair.url).port);
    assert.notEqual(lanPort, port);                                         // a separate listener, the main one stays on loopback
    const paired = await request(ownIp, lanPort, 'GET', '/pair?code=' + new URL(pair.url).searchParams.get('code'));
    assert.equal(paired.status, 302);
    const h = { cookie: paired.headers['set-cookie'][0].split(';')[0] };
    assert.equal((await request(ownIp, lanPort, 'GET', '/', { headers: h })).status, 200);
    await assert.rejects(request(ownIp, port, 'GET', '/'), /ECONNREFUSED/); // the loopback listener is still not on the network
    assert.equal(JSON.parse((await local('/api/lan', { on: false })).body).lan, false);
    await assert.rejects(request(ownIp, lanPort, 'GET', '/', { headers: h }), /ECONNREFUSED|ECONNRESET/); // listener gone
    assert.match((await local('/api/pair', {})).body, /Phone access is off/);
    assert.equal(JSON.parse((await local('/api/lan', { on: true })).body).lan, true);              // and it can be turned on again
    const again = JSON.parse((await local('/api/pair', {})).body);
    assert.equal((await request(ownIp, Number(new URL(again.url).port), 'GET', '/', { headers: h })).status, 401); // old session did not survive
  } finally { await new Promise((r) => server.close(r)); }
});
