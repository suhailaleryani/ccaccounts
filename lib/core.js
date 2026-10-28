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
  return {
    email: (acct && acct.emailAddress) || null,
    org: (acct && acct.organizationName) || null,
    hasCredentialsFile: fs.existsSync(path.join(dir, '.credentials.json')),
  };
}

function listProfiles() {
  if (!fs.existsSync(profilesDir())) return [];
  const act = getActive();
  return fs.readdirSync(profilesDir(), { withFileTypes: true })
    .filter((d) => d.isDirectory() && validName(d.name))
    .map((d) => d.name).sort()
    .map((name) => {
      const info = accountInfo(name);
      return { name, active: name === act, email: info.email, org: info.org,
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
  listProfiles, createProfile, removeProfile, importDefault, runClaude, accountInfo };
