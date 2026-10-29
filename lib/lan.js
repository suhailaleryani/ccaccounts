'use strict';
// Opt-in phone access (`ccaccounts ui --lan`). Off by default. When on, the UI also listens on the local network, but
// only a paired device on a private address gets in, and only a short allowlist of calls (see REMOTE_API).
const os = require('os');
const crypto = require('crypto');

const PAIR_TTL = 5 * 60 * 1000;          // a pairing code (QR) works once, for five minutes
const SESSION_TTL = 7 * 24 * 3600 * 1000;
const COOKIE = 'cca_session';

// What a paired phone may do: see accounts, switch the active one, see activity. Everything that opens terminals or
// browsers, edits settings, installs or removes things stays on the computer itself.
const REMOTE_API = new Set(['GET /api/state', 'POST /api/use', 'POST /api/activity']);

// Normalised IPv4 from a socket address ("::ffff:192.168.1.5" -> "192.168.1.5"); '' when it is not IPv4.
function ipv4(addr) {
  const a = String(addr || '').replace(/^::ffff:/i, '');
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(a) ? a : '';
}
const isLoopback = (addr) => { const a = String(addr || ''); return a === '::1' || /^(::ffff:)?127\./i.test(a); };

// RFC 1918 + link-local + 100.64/10 (CGNAT, which Tailscale uses). Public addresses are never served.
function isPrivate(addr) {
  const a = ipv4(addr); if (!a) return false;
  const [p, q] = a.split('.').map(Number);
  return p === 10 || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168) || (p === 169 && q === 254) || (p === 100 && q >= 64 && q <= 127);
}

// This computer's private IPv4 addresses, most likely to be reachable from a phone first: real Wi-Fi/Ethernet, then VPN
// overlays (Tailscale, ZeroTier), then virtual adapters (VirtualBox, Hyper-V, Docker, WSL), which a phone cannot reach.
const VIRTUAL = /vethernet|virtualbox|vbox|vmware|vmnet|hyper-v|docker|wsl|veth|virbr|^br-|bridge|loopback/i;
const OVERLAY = /tailscale|zerotier|wireguard|^utun|^tun/i;
const WIFI = /wi-?fi|wlan|wireless|^en0$/i;
function lanInterfaces(ifaces = os.networkInterfaces()) {
  const out = [];
  for (const [name, list] of Object.entries(ifaces))
    for (const i of list || []) if (!i.internal && i.family === 'IPv4' && isPrivate(i.address)) {
      const virtual = VIRTUAL.test(name) || i.address.startsWith('192.168.56.'); // VirtualBox host-only default
      const rank = virtual ? 3 : OVERLAY.test(name) || i.address.startsWith('100.') ? 2 : WIFI.test(name) ? 0 : 1;
      out.push({ name, address: i.address, rank });
    }
  return out.sort((a, b) => a.rank - b.rank);
}
const lanAddresses = (ifaces) => lanInterfaces(ifaces).map((i) => i.address);

// Decide who is asking. Returns 'local' (this computer), 'remote' (a private-network device) or null (refuse).
// The socket address decides, never the Host header, since a LAN client can claim any Host. A remote client must also
// address us by one of our own IPs, which blocks DNS rebinding.
function classify({ remoteAddress, host, lan, own = lanAddresses() }) {
  const h = String(host || '').split(':')[0].toLowerCase();
  if (isLoopback(remoteAddress)) return h === '127.0.0.1' || h === 'localhost' ? 'local' : null;
  if (!lan || !isPrivate(remoteAddress)) return null;
  return own.includes(h) ? 'remote' : null;
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim(); }
  return out;
}

function pairing(now = () => Date.now()) {
  const codes = new Map(), sessions = new Map();
  return {
    newCode() { const c = crypto.randomBytes(16).toString('hex'); codes.set(c, now() + PAIR_TTL); return { code: c, ttlSec: PAIR_TTL / 1000 }; },
    // A code is consumed whether or not it is still valid, so it can never be tried twice.
    redeem(code) {
      const exp = codes.get(code); codes.delete(code);
      if (!exp || exp < now()) return null;
      const sid = crypto.randomBytes(24).toString('hex'); sessions.set(sid, now() + SESSION_TTL); return sid;
    },
    valid(sid) { const exp = sessions.get(sid); if (!exp) return false; if (exp < now()) { sessions.delete(sid); return false; } return true; },
    revokeAll() { const n = sessions.size; sessions.clear(); codes.clear(); return n; },
    count() { return sessions.size; },
  };
}

// Lax, not Strict: a QR code is opened from the camera or a scanner app, and browsers then treat the /pair -> / redirect as
// cross-site and withhold Strict cookies, which left the phone "not paired". Lax is still not sent on cross-site POSTs, and
// every API call also needs the per-run token.
const sessionCookie = (sid) => `${COOKIE}=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL / 1000}`;

module.exports = { REMOTE_API, COOKIE, PAIR_TTL, ipv4, isLoopback, isPrivate, lanInterfaces, lanAddresses, classify, parseCookies, pairing, sessionCookie };
