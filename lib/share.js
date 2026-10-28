'use strict';
// Shared settings: link an item (CLAUDE.md, skills, ...) in several accounts to one copy in
// ~/.ccaccounts/shared, so you configure it once. Sharing is opt-in per account and per item.
const fs = require('fs');
const path = require('path');
const core = require('./core');

const ITEMS = [
  { id: 'CLAUDE.md', kind: 'file', label: 'CLAUDE.md (your instructions)', empty: '' },
  { id: 'settings.json', kind: 'file', label: 'settings.json (permissions, hooks, env)', empty: '{}\n' },
  { id: 'skills', kind: 'dir', label: 'skills' },
  { id: 'agents', kind: 'dir', label: 'agents' },
  { id: 'commands', kind: 'dir', label: 'commands (slash commands)' },
];

const sharedRoot = () => path.join(core.root(), 'shared');
const find = (id) => ITEMS.find((i) => i.id === id);

const lstat = (p) => { try { return fs.lstatSync(p); } catch { return null; } };
const real = (p) => { try { return fs.realpathSync(p); } catch { return null; } };

// Shared = a symlink/junction that resolves to the shared copy (or, for a hard-link fallback, the same file).
function isShared(n, id) {
  const p = path.join(core.profilePath(n), id), s = path.join(sharedRoot(), id);
  const ls = lstat(p);
  if (!ls) return false;
  const rp = real(p), rs = real(s);
  if (ls.isSymbolicLink()) return !!rp && rp === rs;
  const ss = lstat(s);
  return ls.isFile() && !!ss && ss.isFile() && ls.ino !== 0 && ls.ino === ss.ino && ls.dev === ss.dev;
}

function status(n) {
  return Object.fromEntries(ITEMS.map((i) => [i.id, isShared(n, i.id)]));
}

function makeLink(target, p, kind) {
  try { fs.symlinkSync(target, p, kind === 'dir' ? 'junction' : 'file'); return; }
  catch (e) { if (kind === 'dir' || !core.isWin) throw e; }
  fs.linkSync(target, p); // Windows without symlink rights: a hard link still works for files
}

function setShared(n, id, on) {
  if (!core.exists(n)) throw new Error(`No such profile: ${n}`);
  const it = find(id);
  if (!it) throw new Error(`Unknown item "${id}". Use: ${ITEMS.map((i) => i.id).join(', ')}`);
  const p = path.join(core.profilePath(n), id), s = path.join(sharedRoot(), id);

  if (on) {
    if (isShared(n, id)) return;
    fs.mkdirSync(sharedRoot(), { recursive: true });
    const mine = lstat(p);
    if (!lstat(s)) {
      if (mine && !mine.isSymbolicLink()) fs.renameSync(p, s); // this account's copy becomes the shared one
      else if (it.kind === 'dir') fs.mkdirSync(s);
      else fs.writeFileSync(s, it.empty);
    } else if (mine) {
      // never discard what the account already has: keep it beside the link
      if (mine.isSymbolicLink()) fs.unlinkSync(p);
      else fs.renameSync(p, `${p}.backup-${Date.now()}`);
    }
    makeLink(s, p, it.kind);
  } else {
    if (!isShared(n, id)) return;
    fs.unlinkSync(p); // removes the link only, never the shared copy
    if (lstat(s)) fs.cpSync(s, p, { recursive: true }); // the account keeps a private copy
  }
}

// Used before deleting an account: drop links so recursive delete can't reach the shared store.
function detachAll(n) {
  for (const i of ITEMS) {
    if (isShared(n, i.id)) { try { fs.unlinkSync(path.join(core.profilePath(n), i.id)); } catch {} }
  }
}

module.exports = { ITEMS, sharedRoot, status, setShared, detachAll };
