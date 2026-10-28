'use strict';
// Profile storage + launching claude. Each profile is a CLAUDE_CONFIG_DIR.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const isWin = process.platform === 'win32';

const root = () => process.env.CCACCOUNTS_HOME || path.join(os.homedir(), '.ccaccounts');
const profilesDir = () => path.join(root(), 'profiles');
const activeFile = () => path.join(root(), 'active');

// Must start alphanumeric so "." / ".." / "-x" can never be a profile.
const validName = (n) => typeof n === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(n);
const profilePath = (n) => path.join(profilesDir(), n);
const exists = (n) => validName(n) && fs.existsSync(profilePath(n));

function getActive() {
  try {
    const n = fs.readFileSync(activeFile(), 'utf8').trim();
    return exists(n) ? n : '';
  } catch { return ''; }
}

function setActive(n) {
  if (!exists(n)) throw new Error(`No such profile: ${n}`);
  fs.mkdirSync(root(), { recursive: true });
  const tmp = activeFile() + '.tmp';
  fs.writeFileSync(tmp, n);
  fs.renameSync(tmp, activeFile()); // atomic so shells never read a half-written file
}

function readJson(f) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}

function accountInfo(n) {
  const dir = profilePath(n);
  const j = readJson(path.join(dir, '.claude.json'));
  const acct = j && j.oauthAccount;
  // Read only the non-secret fields from the credentials file.
  const oauth = (readJson(path.join(dir, '.credentials.json')) || {}).claudeAiOauth || {};
  const now = Date.now();
  const hasToken = !!(oauth.accessToken || oauth.refreshToken);
  // The access token renews itself while the refresh token is valid; only a dead refresh token means "sign in again".
  const refreshDead = oauth.refreshTokenExpiresAt ? oauth.refreshTokenExpiresAt < now
    : !oauth.refreshToken && !!oauth.expiresAt && oauth.expiresAt < now;
  return {
    email: (acct && acct.emailAddress) || null,
    org: (acct && acct.organizationName) || null,
    plan: typeof oauth.subscriptionType === 'string' ? oauth.subscriptionType : null,
    loginExpired: hasToken && refreshDead,
    hasCredentialsFile: fs.existsSync(path.join(dir, '.credentials.json')),
  };
}

// Per-profile settings, stored beside the login in ccaccounts.json.
const settingsFile = (n) => path.join(profilePath(n), 'ccaccounts.json');
const TERMINALS = ['', 'cmd', 'powershell', 'wt']; // '' = automatic. Windows only; other platforms auto-detect.
const COLOR_RE = /^#[0-9a-f]{6}$/i;
// Extra `claude` arguments end up on a command line, so allow plain flags only (no shell metacharacters).
const ARGS_RE = /^[\w\s.=:/\\@,+-]*$/;

function getSettings(n) {
  const j = (exists(n) && readJson(settingsFile(n))) || {};
  const s = (k) => (typeof j[k] === 'string' ? j[k] : '');
  return { workDir: s('workDir'), note: s('note'), color: COLOR_RE.test(s('color')) ? s('color') : '',
           args: ARGS_RE.test(s('args')) ? s('args') : '', terminal: TERMINALS.includes(s('terminal')) ? s('terminal') : '' };
}

// Validates and merges only the keys present in `patch`; an empty value clears that key.
function updateSettings(n, patch) {
  if (!exists(n)) throw new Error(`No such profile: ${n}`);
  const next = {};
  for (const [k, raw] of Object.entries(patch)) {
    if (raw == null) continue;
    let v = String(raw).trim();
    if (k === 'workDir' && v) {
      v = path.resolve(v.replace(/^~(?=$|[\\/])/, os.homedir()));
      if (/["\r\n]/.test(v)) throw new Error('Folder path contains unsupported characters');
      let st; try { st = fs.statSync(v); } catch { throw new Error(`Folder not found: ${v}`); }
      if (!st.isDirectory()) throw new Error(`Not a folder: ${v}`);
    } else if (k === 'color' && v && !COLOR_RE.test(v)) throw new Error('Colour must look like #c96442');
    else if (k === 'args' && !ARGS_RE.test(v)) throw new Error('Extra options may only contain letters, digits, spaces and . = : / \\ @ , + -');
    else if (k === 'terminal' && !TERMINALS.includes(v)) throw new Error(`Terminal must be one of: ${TERMINALS.filter(Boolean).join(', ')}`);
    else if (k === 'note') v = v.slice(0, 200).replace(/[\r\n]+/g, ' ');
    else if (!['workDir', 'color', 'args', 'terminal'].includes(k)) throw new Error(`Unknown setting: ${k}`);
    next[k] = v;
  }
  const j = readJson(settingsFile(n)) || {};
  for (const [k, v] of Object.entries(next)) { if (v) j[k] = v; else delete j[k]; }
  fs.writeFileSync(settingsFile(n), JSON.stringify(j, null, 2));
  if (next.workDir) pushRecent(next.workDir);
  return getSettings(n);
}

const getWorkDir = (n) => getSettings(n).workDir;
const setWorkDir = (n, dir) => updateSettings(n, { workDir: dir || '' }).workDir;

// Saved folder if it still exists, otherwise home.
function launchDir(n) {
  const d = getWorkDir(n);
  try { if (d && fs.statSync(d).isDirectory()) return d; } catch {}
  return os.homedir();
}

// Most recently used folders across all accounts (newest first), for one-click reuse in the UI.
const recentFile = () => path.join(root(), 'recent.json');

function getRecent() {
  const j = readJson(recentFile());
  const isDir = (d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } };
  return Array.isArray(j) ? j.filter((d) => typeof d === 'string' && isDir(d)) : [];
}

function pushRecent(dir) {
  if (!dir) return;
  const list = [dir, ...getRecent().filter((d) => d !== dir)].slice(0, 8);
  fs.mkdirSync(root(), { recursive: true });
  fs.writeFileSync(recentFile(), JSON.stringify(list));
}

// Folder bindings: { "<absolute folder>": "<profile>" }. A binding covers the folder and everything below it,
// so `claude` run there uses that account instead of the active one.
const bindingsFile = () => path.join(root(), 'bindings.json');
const readBindings = () => { const j = readJson(bindingsFile()); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; };
function writeBindings(b) {
  fs.mkdirSync(root(), { recursive: true });
  fs.writeFileSync(bindingsFile(), JSON.stringify(b, null, 2));
}
const norm = (p) => { const r = path.resolve(p); return isWin ? r.toLowerCase() : r; };

function getBindings() {
  const b = readBindings();
  return Object.entries(b).filter(([, n]) => exists(n)).map(([dir, name]) => ({ dir, name }));
}

function bindFolder(n, dir) {
  if (!exists(n)) throw new Error(`No such profile: ${n}`);
  const d = path.resolve((dir || '').trim().replace(/^~(?=$|[\\/])/, os.homedir()));
  let st; try { st = fs.statSync(d); } catch { throw new Error(`Folder not found: ${d}`); }
  if (!st.isDirectory()) throw new Error(`Not a folder: ${d}`);
  const b = readBindings();
  for (const k of Object.keys(b)) if (norm(k) === norm(d)) delete b[k]; // one account per folder
  b[d] = n;
  writeBindings(b);
  return d;
}

function unbindFolder(dir) {
  const b = readBindings(); let hit = false;
  for (const k of Object.keys(b)) if (norm(k) === norm(dir)) { delete b[k]; hit = true; }
  if (hit) writeBindings(b);
  return hit;
}

// Account that applies in `cwd`: the deepest bound folder containing it, else the active account.
function resolveAccount(cwd = process.cwd()) {
  const here = norm(cwd);
  let best = null;
  for (const { dir, name } of getBindings()) {
    const d = norm(dir);
    if ((here === d || here.startsWith(d.endsWith(path.sep) ? d : d + path.sep)) && (!best || d.length > norm(best.dir).length))
      best = { dir, name };
  }
  return best ? { name: best.name, boundTo: best.dir } : { name: getActive(), boundTo: null };
}

function listProfiles() {
  if (!fs.existsSync(profilesDir())) return [];
  const act = getActive();
  return fs.readdirSync(profilesDir(), { withFileTypes: true })
    .filter((d) => d.isDirectory() && validName(d.name))
    .map((d) => d.name).sort()
    .map((name) => {
      const info = accountInfo(name);
      return { name, active: name === act, email: info.email, org: info.org, plan: info.plan, loginExpired: info.loginExpired,
               ...getSettings(name),
               loggedIn: !!info.email || info.hasCredentialsFile };
    });
}

function createProfile(n) {
  if (!validName(n)) throw new Error('Name must be letters, digits, ".", "_" or "-" and start with a letter or digit');
  if (exists(n)) throw new Error(`Profile "${n}" already exists`);
  fs.mkdirSync(profilePath(n), { recursive: true, mode: 0o700 });
  if (!getActive()) setActive(n);
}

function removeProfile(n) {
  if (!exists(n)) throw new Error(`No such profile: ${n}`);
  require('./share').detachAll(n); // unlink shared items first so deleting never reaches the shared store
  const b = readBindings();
  for (const d of Object.keys(b)) if (b[d] === n) delete b[d];
  writeBindings(b);
  fs.rmSync(profilePath(n), { recursive: true, force: true });
  if (!getActive()) { try { fs.rmSync(activeFile(), { force: true }); } catch {} }
}

// Copy only login/settings from the current default install (not history, which can be huge).
// On macOS the OAuth token lives in the Keychain, not on disk, so the new profile needs /login.
function importDefault(n) {
  const src = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const legacy = path.join(os.homedir(), '.claude.json');
  if (!fs.existsSync(src) && !fs.existsSync(legacy)) throw new Error('No existing Claude Code config found to import');
  createProfile(n);
  const dst = profilePath(n);
  for (const f of ['.credentials.json', '.claude.json', 'settings.json', 'CLAUDE.md']) {
    const p = path.join(src, f);
    if (fs.existsSync(p)) fs.copyFileSync(p, path.join(dst, f));
  }
  if (!fs.existsSync(path.join(dst, '.claude.json')) && fs.existsSync(legacy))
    fs.copyFileSync(legacy, path.join(dst, '.claude.json'));
  return { needsLogin: !accountInfo(n).hasCredentialsFile };
}

// ---- launching claude ------------------------------------------------------

// Windows: claude is usually a .cmd shim, which needs a shell. Quote args ourselves.
const winQuote = (a) => (/^[\w./:=@-]+$/.test(a) ? a : '"' + a.replace(/"/g, '""') + '"');

function runClaude(n, args = [], opts = {}) {
  if (!exists(n)) throw new Error(`No such profile: ${n}`);
  const env = { ...process.env, CLAUDE_CONFIG_DIR: profilePath(n) };
  const r = isWin
    ? spawnSync(['claude', ...args.map(winQuote)].join(' '), { stdio: 'inherit', env, shell: true, ...opts })
    : spawnSync('claude', args, { stdio: 'inherit', env, ...opts });
  if (r.error) {
    throw new Error(r.error.code === 'ENOENT'
      ? 'Could not find the "claude" command. Install Claude Code first: https://docs.claude.com/claude-code'
      : r.error.message);
  }
  return r.status == null ? 1 : r.status;
}

module.exports = { isWin, root, validName, profilePath, exists, getActive, setActive,
  getBindings, bindFolder, unbindFolder, resolveAccount, getRecent, getSettings, updateSettings, getWorkDir, setWorkDir, launchDir, listProfiles, createProfile, removeProfile, importDefault, runClaude, accountInfo };
