'use strict';
// Local web UI. Binds to 127.0.0.1 only; every API call needs a per-run token (blocks CSRF / DNS rebinding).
const http = require('http');
const crypto = require('crypto');
const os = require('os');
const core = require('./core');
const { openTerminal, openUrl } = require('./terminal');
const chrome = require('./chrome');

const PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ccswitch</title>
<style>
:root{
  --bg:#f6f4ef; --panel:#ffffff; --panel-2:#faf8f4; --text:#1f1d1a; --muted:#78736a; --line:#e8e3d9;
  --accent:#c96442; --accent-ink:#ffffff; --accent-soft:#f8e9e2; --ok:#2f8f5b; --warn:#b7791f; --danger:#c0392b;
  --shadow:0 1px 2px rgba(30,25,15,.05),0 8px 24px rgba(30,25,15,.06);
}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){
  --bg:#191816; --panel:#242220; --panel-2:#2b2926; --text:#f0ece4; --muted:#9a948a; --line:#37342f;
  --accent:#e0784f; --accent-ink:#1a1816; --accent-soft:#3a2a23; --ok:#4cc38a; --warn:#e0b04f; --danger:#ef6b5c;
  --shadow:0 1px 2px rgba(0,0,0,.3),0 8px 24px rgba(0,0,0,.25);}}
:root[data-theme=dark]{
  --bg:#191816; --panel:#242220; --panel-2:#2b2926; --text:#f0ece4; --muted:#9a948a; --line:#37342f;
  --accent:#e0784f; --accent-ink:#1a1816; --accent-soft:#3a2a23; --ok:#4cc38a; --warn:#e0b04f; --danger:#ef6b5c;
  --shadow:0 1px 2px rgba(0,0,0,.3),0 8px 24px rgba(0,0,0,.25);}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:720px;margin:0 auto;padding:40px 20px 80px}
header{display:flex;align-items:center;gap:14px;margin-bottom:28px}
.logo{width:40px;height:40px;border-radius:12px;background:var(--accent);color:var(--accent-ink);display:grid;place-items:center;font-weight:700;font-size:18px;box-shadow:var(--shadow)}
h1{font-size:22px;margin:0;letter-spacing:-.01em}
.sub{color:var(--muted);font-size:13px}
.spacer{flex:1}
button{font:inherit;cursor:pointer;border:1px solid var(--line);background:var(--panel);color:var(--text);border-radius:10px;padding:8px 14px;transition:.15s}
button:hover{border-color:var(--muted)}
button:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
button.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink);font-weight:600}
button.primary:hover{filter:brightness(1.07)}
button.ghost{border-color:transparent;background:transparent;color:var(--muted);padding:6px 10px}
button.ghost:hover{color:var(--text);background:var(--panel-2)}
button.danger:hover{color:var(--danger)}
.banner{display:flex;align-items:center;gap:12px;background:var(--accent-soft);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin-bottom:22px}
.dot{width:9px;height:9px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 4px color-mix(in srgb,var(--ok) 22%,transparent)}
.banner b{font-weight:600}
.list{display:grid;gap:12px}
.card{display:flex;flex-wrap:wrap;align-items:center;gap:14px;background:var(--panel);border:1.5px solid var(--line);border-radius:16px;padding:16px;box-shadow:var(--shadow);transition:.15s;animation:in .25s ease both}
.card:hover{transform:translateY(-1px)}
.card.active{border-color:var(--accent)}
@keyframes in{from{opacity:0;transform:translateY(6px)}}
.avatar{width:46px;height:46px;border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:700;font-size:18px;flex:none}
.meta{min-width:0;flex:1}
.name{font-weight:600;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.name .pill{white-space:nowrap}
.email{color:var(--muted);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pill{font-size:11px;font-weight:600;padding:2px 8px;border-radius:99px;background:var(--accent);color:var(--accent-ink);letter-spacing:.02em}
.pill.warn{background:transparent;color:var(--warn);border:1px solid var(--warn)}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
.chip{white-space:nowrap;display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--muted);border:1px solid var(--line);border-radius:99px;padding:1px 9px;background:var(--panel-2)}
.chip i{width:7px;height:7px;border-radius:50%;background:var(--line);display:inline-block}
.chip.ok i{background:var(--ok)} .chip.ok{color:var(--text)} .chip.todo i{background:var(--warn)}
.check{display:flex;align-items:center;gap:8px;margin-top:14px;font-size:14px}.check input{width:auto}
.actions{display:flex;gap:4px;align-items:center;flex-wrap:wrap;width:100%;padding-top:12px;margin-top:2px;border-top:1px solid var(--line)}
.empty{text-align:center;padding:56px 20px;color:var(--muted);background:var(--panel);border:1.5px dashed var(--line);border-radius:16px}
.empty h2{color:var(--text);font-size:18px;margin:0 0 6px}
.tip{margin-top:26px;color:var(--muted);font-size:13px;background:var(--panel-2);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
code{font:12.5px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--panel);border:1px solid var(--line);padding:1px 6px;border-radius:6px}
dialog{border:1px solid var(--line);border-radius:18px;background:var(--panel);color:var(--text);padding:24px;width:min(420px,92vw);box-shadow:0 20px 60px rgba(0,0,0,.3)}
dialog::backdrop{background:rgba(20,16,10,.45);backdrop-filter:blur(3px)}
dialog h2{margin:0 0 4px;font-size:18px} dialog p{margin:0 0 16px;color:var(--muted);font-size:13px}
input{width:100%;font:inherit;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:var(--panel-2);color:var(--text)}
.row{display:flex;gap:8px;justify-content:flex-end;margin-top:18px}
.err{color:var(--danger);font-size:13px;min-height:18px;margin-top:6px}
#toast{position:fixed;left:50%;bottom:28px;transform:translate(-50%,20px);background:var(--text);color:var(--bg);padding:10px 16px;border-radius:12px;opacity:0;pointer-events:none;transition:.25s;font-size:14px;max-width:90vw}
#toast.show{opacity:1;transform:translate(-50%,0)}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="logo">cc</div>
    <div><h1>Claude Code accounts</h1><div class="sub" id="sub"></div></div>
    <div class="spacer"></div>
    <button id="theme" class="ghost" title="Toggle theme" aria-label="Toggle theme"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg></button>
    <button id="add" class="primary">+ Add account</button>
  </header>
  <div id="banner"></div>
  <div class="list" id="list" aria-live="polite"></div>
  <div class="tip" id="tip"></div>
</div>

<dialog id="dlg">
  <form method="dialog" id="form">
    <h2>Add account</h2>
    <p>Pick a short label. A terminal opens for Claude Code sign-in, and Chrome opens a separate profile for the Claude in Chrome extension.</p>
    <input id="newname" placeholder="e.g. work, personal" autocomplete="off" maxlength="64" required>
    <label class="check"><input type="checkbox" id="withChrome" checked> Also set up Claude in Chrome</label>
    <div class="err" id="err"></div>
    <div class="row"><button type="button" id="cancel">Cancel</button><button class="primary" id="create">Create &amp; sign in</button></div>
  </form>
</dialog>
<div id="toast" role="status"></div>

<script>
const TOKEN = "__TOKEN__";
const $ = (id) => document.getElementById(id);
const COLORS = ["#c96442","#4f7cac","#6a994e","#8e5ea2","#d08c2c","#2a9d8f","#b5586b","#5c6bc0"];
const colorFor = (s) => COLORS[[...s].reduce((a,c)=>a+c.charCodeAt(0),0) % COLORS.length];

async function api(path, body){
  const r = await fetch(path, {method: body ? "POST" : "GET", headers: {"x-token": TOKEN, "content-type":"application/json"}, body: body ? JSON.stringify(body) : undefined});
  const j = await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
let tt;
function toast(m){ const t=$("toast"); t.textContent=m; t.classList.add("show"); clearTimeout(tt); tt=setTimeout(()=>t.classList.remove("show"),2600); }
function el(tag, cls, text){ const e=document.createElement(tag); if(cls) e.className=cls; if(text!=null) e.textContent=text; return e; }
function btn(label, cls, fn){ const b=el("button",cls,label); b.onclick=async()=>{ try{ await fn(); }catch(e){ toast(e.message); } }; return b; }

async function render(){
  const d = await api("/api/state");
  $("sub").textContent = d.platform + " · " + d.count + " account" + (d.count===1?"":"s");
  const act = d.profiles.find(p=>p.active);
  const banner = $("banner"); banner.replaceChildren();
  if(act){
    const b = el("div","banner"); b.append(el("span","dot"));
    const t = el("div"); const s = el("b",null,act.name); t.append("Active account: ", s, act.email ? " · "+act.email : "");
    b.append(t); banner.append(b);
  }
  const list = $("list"); list.replaceChildren();
  if(!d.profiles.length){
    const e = el("div","empty"); e.append(el("h2",null,"No accounts yet"), el("div",null,"Add your first Claude Code account to get started."));
    list.append(e);
  }
  [...d.profiles].sort((a,b)=>b.active-a.active).forEach((p,i)=>{
    const c = el("div","card"+(p.active?" active":"")); c.style.animationDelay=(i*40)+"ms";
    const av = el("div","avatar",p.name[0].toUpperCase()); av.style.background=colorFor(p.name);
    const m = el("div","meta"); const n = el("div","name",p.name);
    if(p.active) n.append(el("span","pill","ACTIVE"));
    if(!p.loggedIn) n.append(el("span","pill warn","NOT SIGNED IN"));
    m.append(n, el("div","email",p.email || (p.loggedIn ? "Signed in" : "Sign in to link an account")));
    const chips = el("div","chips");
    const mk = (ok,label)=>{ const c=el("span","chip "+(ok?"ok":"todo")); c.append(el("i"), label); return c; };
    chips.append(mk(p.loggedIn,"Claude Code"), mk(p.chrome.extensionInstalled,"Chrome extension"));
    m.append(chips);
    const a = el("div","actions");
    if(!p.active) a.append(btn("Switch to this","primary",async()=>{ await api("/api/use",{name:p.name}); toast("Now using "+p.name); render(); }));
    a.append(btn("Open Claude","",async()=>{ await api("/api/open",{name:p.name}); toast("Opening terminal…"); }));
    a.append(btn(p.loggedIn&&p.chrome.extensionInstalled?"Re-login":"Sign in","ghost",async()=>{ await api("/api/signin",{name:p.name}); toast("Sign in: /login in the terminal, claude.ai in Chrome"); }));
    a.append(btn("Chrome","ghost",async()=>{ await api("/api/chrome",{name:p.name}); toast("Opening Chrome profile…"); }));
    a.append(btn("Remove","ghost danger",async()=>{ if(!confirm('Remove "'+p.name+'" and its saved login?')) return; await api("/api/remove",{name:p.name}); toast("Removed "+p.name); render(); }));
    c.append(av,m,a); list.append(c);
  });
  const tip = $("tip");
  tip.replaceChildren("Switching changes the account used by every new ", el("code",null,"claude")," in your terminals once the shell hook is installed (", el("code",null,"ccswitch install"),"). Already-running sessions keep their account. Claude Code and the Chrome extension must be signed in to the same claude.ai account to connect.");
}

$("add").onclick=()=>{ $("newname").value=""; $("err").textContent=""; $("dlg").showModal(); $("newname").focus(); };
$("cancel").onclick=()=>$("dlg").close();
$("form").onsubmit=async(e)=>{
  e.preventDefault();
  try{ const name=$("newname").value.trim(); await api("/api/add",{name, withChrome: $("withChrome").checked}); $("dlg").close(); toast("Created "+name+" — finish signing in in the terminal and Chrome"); render(); }
  catch(x){ $("err").textContent=x.message; }
};
$("theme").onclick=()=>{
  const r=document.documentElement; const dark = r.dataset.theme ? r.dataset.theme==="dark" : matchMedia("(prefers-color-scheme:dark)").matches;
  r.dataset.theme = dark ? "light" : "dark"; try{ localStorage.setItem("theme", r.dataset.theme); }catch{}
};
try{ const t=localStorage.getItem("theme"); if(t) document.documentElement.dataset.theme=t; }catch{}
render().catch(e=>toast(e.message));
</script>
</body>
</html>`;

function start({ port = 4455, open = true } = {}) {
  const token = crypto.randomBytes(24).toString('hex');
  let boundPort = port;

  const send = (res, code, body, type = 'application/json') => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
  };
  const readBody = (req) => new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 10_000) { reject(new Error('Body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { reject(new Error('Bad JSON')); } });
  });

  const server = http.createServer(async (req, res) => {
    try {
      // Reject DNS-rebinding: only accept requests addressed to localhost.
      const host = (req.headers.host || '').split(':')[0];
      if (host !== '127.0.0.1' && host !== 'localhost') return send(res, 403, { error: 'Forbidden' });

      if (req.method === 'GET' && req.url === '/') return send(res, 200, PAGE.replace('__TOKEN__', token), 'text/html; charset=utf-8');

      if (req.headers['x-token'] !== token) return send(res, 401, { error: 'Unauthorized' });

      if (req.method === 'GET' && req.url === '/api/state') {
        const profiles = core.listProfiles().map((p) => ({ ...p, chrome: chrome.status(p.name) }));
        const names = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
        return send(res, 200, { profiles, count: profiles.length, platform: names[process.platform] || process.platform });
      }
      if (req.method === 'POST') {
        const { name, withChrome } = await readBody(req);
        if (req.url === '/api/use') { core.setActive(name); return send(res, 200, { ok: true }); }
        if (req.url === '/api/add') { core.createProfile(name); openTerminal(name, os.homedir()); if (withChrome) chrome.openProfile(name); return send(res, 200, { ok: true }); }
        if (req.url === '/api/chrome') { if (!core.exists(name)) throw new Error('No such account'); chrome.openProfile(name); return send(res, 200, { ok: true }); }
        if (req.url === '/api/signin') { if (!core.exists(name)) throw new Error('No such account'); openTerminal(name, os.homedir()); if (withChrome !== false) chrome.openProfile(name); return send(res, 200, { ok: true }); }
        if (req.url === '/api/open') { openTerminal(name, os.homedir()); return send(res, 200, { ok: true }); }
        if (req.url === '/api/remove') { core.removeProfile(name); return send(res, 200, { ok: true }); }
      }
      send(res, 404, { error: 'Not found' });
    } catch (e) {
      send(res, 400, { error: e.message });
    }
  });

  return new Promise((resolve, reject) => {
    const listen = (p) => server.listen(p, '127.0.0.1');
    server.on('error', (e) => { if (e.code === 'EADDRINUSE' && boundPort !== 0) { boundPort = 0; listen(0); } else reject(e); });
    server.on('listening', () => {
      const url = `http://127.0.0.1:${server.address().port}/`;
      if (open) openUrl(url);
      resolve({ server, url });
    });
    listen(boundPort);
  });
}

module.exports = { start };
