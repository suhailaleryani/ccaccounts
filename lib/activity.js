'use strict';
// Local activity per account (replies and tokens per day), read from the session logs. Claude Code does not
// store plan limits locally, so this shows what you used, not what is left. Per-file results are cached on disk
// by size + modified time, so only changed logs are re-read.
const fs = require('fs');
const path = require('path');
const core = require('./core');

const cacheFile = () => path.join(core.root(), 'activity-cache.json');
const DAY = 86400000;

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; // local date

function readCache() { try { return JSON.parse(fs.readFileSync(cacheFile(), 'utf8')); } catch { return {}; } }

// One API reply is written as several lines sharing a message id; keep the last (complete) usage per id.
function summarizeLog(text) {
  const byId = new Map();
  for (const line of text.split('\n')) {
    if (!line.includes('"type":"assistant"')) continue; // cheap filter before JSON.parse
    let j; try { j = JSON.parse(line); } catch { continue; }
    const m = j.message, u = m && m.usage;
    if (j.type !== 'assistant' || !u || !m.id || !j.timestamp) continue;
    const t = new Date(j.timestamp);
    if (isNaN(t)) continue;
    byId.set(m.id, { day: dayKey(t), model: m.model || 'unknown',
      tokens: (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0) }); // cache reads excluded: they would dwarf real work
  }
  const days = {};
  for (const { day, model, tokens } of byId.values()) {
    const d = (days[day] = days[day] || { replies: 0, tokens: 0, models: {} });
    d.replies++; d.tokens += tokens; d.models[model] = (d.models[model] || 0) + 1;
  }
  return days;
}

async function activity(n, nDays = 7, now = Date.now()) {
  if (!core.exists(n)) throw new Error(`No such profile: ${n}`);
  const base = path.join(core.profilePath(n), 'projects');
  const cutoff = now - nDays * DAY;
  const cache = readCache(), fresh = {};
  const files = [];
  try {
    for (const d of fs.readdirSync(base, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      for (const f of fs.readdirSync(path.join(base, d.name))) {
        if (!f.endsWith('.jsonl')) continue;
        const full = path.join(base, d.name, f);
        try { const st = fs.statSync(full); if (st.mtimeMs >= cutoff - DAY) files.push({ full, key: `${full}|${st.size}|${st.mtimeMs}` }); } catch {}
      }
    }
  } catch {} // no projects folder yet

  const total = {};
  for (const { full, key } of files) {
    let days = cache[key];
    if (!days) {
      try { days = summarizeLog(await fs.promises.readFile(full, 'utf8')); } catch { continue; }
      await new Promise((r) => setImmediate(r)); // let the server answer other requests between big files
    }
    fresh[key] = days;
    for (const [day, v] of Object.entries(days)) {
      const t = (total[day] = total[day] || { replies: 0, tokens: 0, models: {} });
      t.replies += v.replies; t.tokens += v.tokens;
      for (const [m, c] of Object.entries(v.models)) t.models[m] = (t.models[m] || 0) + c;
    }
  }
  // Keep only entries seen this run (other accounts' entries stay: merge, then drop anything outside the window).
  const merged = { ...Object.fromEntries(Object.entries(cache).filter(([k]) => !k.startsWith(base))), ...fresh };
  try { fs.mkdirSync(core.root(), { recursive: true }); fs.writeFileSync(cacheFile(), JSON.stringify(merged)); } catch {}

  const out = [], models = {};
  for (let i = nDays - 1; i >= 0; i--) {
    const date = dayKey(new Date(now - i * DAY)), v = total[date] || { replies: 0, tokens: 0, models: {} };
    out.push({ date, replies: v.replies, tokens: v.tokens });
    for (const [m, c] of Object.entries(v.models)) models[m] = (models[m] || 0) + c;
  }
  const top = Object.entries(models).sort((a, b) => b[1] - a[1])[0];
  return { days: out, replies: out.reduce((s, d) => s + d.replies, 0), tokens: out.reduce((s, d) => s + d.tokens, 0),
           topModel: top ? top[0] : '' };
}

module.exports = { activity, summarizeLog, dayKey };
