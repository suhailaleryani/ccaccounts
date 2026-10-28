'use strict';
// Recent Claude Code sessions of an account, read from <profile>/projects/*/<id>.jsonl, so a
// conversation can be resumed from the UI. Reads only the head of each file.
const fs = require('fs');
const path = require('path');
const core = require('./core');

const HEAD_BYTES = 128 * 1024;
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function head(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    return buf.toString('utf8', 0, fs.readSync(fd, buf, 0, HEAD_BYTES, 0));
  } finally { fs.closeSync(fd); }
}

const textOf = (c) => (typeof c === 'string' ? c
  : Array.isArray(c) ? c.filter((x) => x && x.type === 'text').map((x) => x.text).join(' ') : '');

// First real prompt: skip meta lines, sidechains and injected <command-...>/<system-...> wrappers.
function summarize(file) {
  let cwd = '', title = '';
  for (const line of head(file).split('\n')) {
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (!cwd && typeof j.cwd === 'string') cwd = j.cwd;
    if (!title && j.type === 'user' && !j.isMeta && !j.isSidechain) {
      const t = textOf(j.message && j.message.content).replace(/\s+/g, ' ').trim();
      if (t && !t.startsWith('<')) title = t.length > 90 ? t.slice(0, 89) + '…' : t;
    }
    if (cwd && title) break;
  }
  return { cwd, title };
}

function listSessions(n, limit = 8) {
  if (!core.exists(n)) throw new Error(`No such profile: ${n}`);
  const base = path.join(core.profilePath(n), 'projects');
  const files = [];
  let dirs = [];
  try { dirs = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return []; }
  for (const d of dirs) {
    let names = []; try { names = fs.readdirSync(path.join(base, d.name)); } catch { continue; }
    for (const f of names) {
      const id = f.replace(/\.jsonl$/, '');
      if (!f.endsWith('.jsonl') || !ID_RE.test(id)) continue; // agent-*.jsonl etc. are not resumable sessions
      const full = path.join(base, d.name, f);
      try { files.push({ id, full, mtime: fs.statSync(full).mtimeMs }); } catch {}
    }
  }
  return files.sort((a, b) => b.mtime - a.mtime).slice(0, limit * 3) // read a few extra: some have no usable prompt
    .map((f) => ({ id: f.id, mtime: f.mtime, ...summarize(f.full) }))
    .filter((s) => s.cwd && s.title)
    .slice(0, limit);
}

module.exports = { listSessions, ID_RE };
