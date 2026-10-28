'use strict';
// Local web UI. Binds to 127.0.0.1 only; every API call needs a per-run token (blocks CSRF / DNS rebinding).
const http = require('http');
const crypto = require('crypto');
const os = require('os');
const core = require('./core');
const { openTerminal, openUrl } = require('./terminal');
const chrome = require('./chrome');
const share = require('./share');
const sessions = require('./sessions');
const activity = require('./activity');
const update = require('./update');
const icon = require('./icon');
const fs = require('fs');

const PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ccaccounts</title>
<link rel="icon" type="image/png" href="/favicon.png">
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
.lbl{display:block;font-size:12px;color:var(--muted);margin:12px 0 4px}
select{width:100%;font:inherit;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:var(--panel-2);color:var(--text)}
.swatches{display:flex;gap:8px;flex-wrap:wrap}
.swatches button{width:26px;height:26px;border-radius:50%;padding:0;border:2px solid transparent}
.swatches button.on{border-color:var(--text)}
.act{display:flex;align-items:flex-end;gap:12px;margin-top:8px;color:var(--muted);font-size:12px;min-height:30px}
.bars{display:flex;align-items:flex-end;gap:3px;height:26px}
.bars i{width:7px;border-radius:2px;background:var(--accent);opacity:.85;min-height:2px}
.bars i.zero{background:var(--line);opacity:1}
.note{color:var(--muted);font-size:13px;font-style:italic}
.recent .when{font-size:11px;color:var(--muted);margin-left:6px}
.recent{display:flex;flex-direction:column;gap:4px;margin-top:10px}
.recent:empty{display:none}
.recent button{text-align:left;font:12.5px ui-monospace,Menlo,Consolas,monospace;padding:5px 10px;border-radius:8px;background:var(--panel-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.recent .lbl{font-size:12px;color:var(--muted)}
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
    <button id="refresh" class="ghost" title="Reload the account list" aria-label="Refresh"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 4v5h-5"/></svg></button>
    <button id="update" class="ghost" title="Check for a newer version of ccaccounts">Update</button>
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
    <input id="newdir" placeholder="Work folder, e.g. D:\Projects\myapp (optional, default: home)" autocomplete="off" style="margin-top:10px">
    <div class="recent" id="newrecent"></div>
    <label class="check"><input type="checkbox" id="withChrome" checked> Also set up Claude in Chrome</label>
    <div class="err" id="err"></div>
    <div class="row"><button type="button" id="cancel">Cancel</button><button class="primary" id="create">Create &amp; sign in</button></div>
  </form>
</dialog>
<dialog id="dlg2">
  <form method="dialog" id="form2">
    <h2 id="d2title">Open Claude</h2>
    <p>Which folder should the terminal start in? Pre-filled with the current one.</p>
    <input id="d2dir" placeholder="Folder path (blank = home)" autocomplete="off">
    <div class="recent" id="d2recent"></div>
    <label class="check"><input type="checkbox" id="d2bind"> Always use this account in this folder (and below)</label>
    <div class="err" id="err2"></div>
    <div class="row"><button type="button" id="cancel2">Cancel</button><button class="primary" id="go2">Open</button></div>
  </form>
</dialog>
<dialog id="dlg3">
  <h2 id="d3title">Shared settings</h2>
  <p>Shared items are one copy used by every account that ticks them, so you set them up once. Turning one off gives this account a private copy. Takes effect for new Claude sessions.</p>
  <div id="d3list"></div>
  <div class="err" id="err3"></div>
  <div class="row"><button type="button" class="primary" id="close3">Done</button></div>
</dialog>
<dialog id="dlg4">
  <form method="dialog" id="form4">
    <h2 id="d4title">Account settings</h2>
    <p>Appearance and how its terminal starts.</p>
    <label class="lbl">Note</label>
    <input id="d4note" placeholder="e.g. client A, billed to Acme" maxlength="200" autocomplete="off">
    <label class="lbl">Colour</label>
    <div class="swatches" id="d4colors"></div>
    <label class="lbl">Extra options for <code>claude</code></label>
    <input id="d4args" placeholder="e.g. --model opus" autocomplete="off">
    <div id="d4termbox"><label class="lbl">Terminal</label>
    <select id="d4term"><option value="">Automatic (Command Prompt)</option><option value="wt">Windows Terminal</option><option value="powershell">PowerShell</option><option value="cmd">Command Prompt</option></select></div>
    <div class="err" id="err4"></div>
    <div class="row"><button type="button" id="cancel4">Cancel</button><button class="primary">Save</button></div>
  </form>
</dialog>
<dialog id="dlg6">
  <h2 id="d6title">Update ccaccounts</h2>
  <p id="d6msg">Checking…</p>
  <div id="d6cmd" class="recent"></div>
  <pre id="d6out" style="display:none;max-height:140px;overflow:auto;font:12px ui-monospace,Menlo,Consolas,monospace;background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:8px;white-space:pre-wrap"></pre>
  <div class="row"><button type="button" id="close6">Close</button><button type="button" class="primary" id="go6" style="display:none">Update now</button></div>
</dialog>
<dialog id="dlg5">
  <h2 id="d5title">Recent sessions</h2>
  <p>Click one to continue it in a new terminal.</p>
  <input id="d5q" placeholder="Search by prompt or folder" autocomplete="off">
  <div class="recent" id="d5list" style="max-height:50vh;overflow:auto"></div>
  <div class="row"><button type="button" class="primary" id="close5">Close</button></div>
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

const fmtTokens = (n) => n >= 1e9 ? (n/1e9).toFixed(1)+"B" : n >= 1e6 ? (n/1e6).toFixed(1)+"M" : n >= 1e3 ? Math.round(n/1e3)+"k" : String(n);
$("refresh").onclick=async()=>{ try{ await render(); toast("Refreshed"); }catch(e){ toast(e.message); } };
function showUpdate(r, busy){
  $("d6title").textContent = "Update ccaccounts" + (r.current ? " · v"+r.current : "");
  $("d6msg").textContent = r.blocker ? r.message+" "+r.blocker : r.message;
  const box = $("d6cmd"); box.replaceChildren();
  if(r.canUpdate && r.command){ box.append(el("div","lbl","This will run:"), el("code",null,r.command)); }
  $("go6").style.display = r.canUpdate && !busy ? "" : "none";
  const out = $("d6out"); out.style.display = r.output ? "" : "none"; out.textContent = r.output || "";
}
$("close6").onclick=()=>$("dlg6").close();
$("update").onclick=async()=>{
  showUpdate({message:"Checking for updates…"}); $("dlg6").showModal();
  try{ showUpdate(await api("/api/update-check",{})); }catch(e){ showUpdate({message:e.message}); }
};
$("go6").onclick=async()=>{
  showUpdate({message:"Updating… this can take a minute.", canUpdate:false}, true);
  try{ const r = await api("/api/update-apply",{}); showUpdate({...r, current:r.from}); if(r.ok) toast("Updated to v"+(r.to||"?")); }
  catch(e){ showUpdate({message:e.message}); }
};
let renderId = 0;
// Loaded after the cards appear, one account at a time: the first read of big session logs can take a few seconds.
async function fillActivity(id){
  for(const box of document.querySelectorAll(".act")){
    if(id !== renderId) return; // a newer render replaced these cards
    box.textContent = "Reading activity…";
    try{
      const a = await api("/api/activity",{name:box.dataset.name});
      if(id !== renderId) return;
      box.replaceChildren();
      if(!a.replies){ box.textContent = "No activity in the last 7 days"; continue; }
      const max = Math.max(...a.days.map(d=>d.replies));
      const bars = el("div","bars");
      a.days.forEach(d=>{ const b = el("i", d.replies?"":"zero"); b.style.height = Math.max(8, Math.round(d.replies/max*100))+"%"; b.title = d.date+": "+d.replies+" replies, "+fmtTokens(d.tokens)+" tokens"; bars.append(b); });
      box.append(bars, el("span",null,"Last 7 days: "+a.replies+" replies · "+fmtTokens(a.tokens)+" tokens"+(a.topModel?" · "+a.topModel.replace(/^claude-/,""):"")));
    }catch(e){ box.textContent = ""; }
  }
}
let recent = [], items = [], folderFor = null, lastState = null, settingsFor = null, pickedColor = "";
function openSettings(p){
  settingsFor = p; pickedColor = p.color || ""; $("err4").textContent = "";
  $("d4title").textContent = 'Settings · '+p.name;
  $("d4note").value = p.note || ""; $("d4args").value = p.args || ""; $("d4term").value = p.terminal || "";
  $("d4termbox").style.display = lastState.win ? "" : "none";
  const box = $("d4colors"); box.replaceChildren();
  ["", ...COLORS].forEach(c=>{ const b = el("button", c===pickedColor?"on":""); b.type="button";
    b.style.background = c || colorFor(p.name); b.title = c ? c : "Automatic";
    b.onclick=()=>{ pickedColor=c; [...box.children].forEach(x=>x.classList.remove("on")); b.classList.add("on"); }; box.append(b); });
  $("dlg4").showModal();
}
$("cancel4").onclick=()=>$("dlg4").close();
$("form4").onsubmit=async(e)=>{
  e.preventDefault();
  try{ await api("/api/settings",{name:settingsFor.name, settings:{note:$("d4note").value, color:pickedColor, args:$("d4args").value, terminal:$("d4term").value}});
    $("dlg4").close(); toast("Saved"); render(); }
  catch(x){ $("err4").textContent = x.message; }
};
function ago(ms){ const m=Math.round((Date.now()-ms)/60000); if(m<1) return "just now"; if(m<60) return m+" min ago"; const h=Math.round(m/60); if(h<24) return h+" h ago"; return Math.round(h/24)+" d ago"; }
async function openSessions(p){
  $("d5title").textContent = 'Recent sessions · '+p.name;
  const box = $("d5list"); box.replaceChildren(el("div","lbl","Loading…")); $("d5q").value = ""; $("dlg5").showModal();
  try{
    const {sessions} = await api("/api/sessions",{name:p.name, limit:40});
    const draw = ()=>{
      const q = $("d5q").value.trim().toLowerCase();
      const shown = sessions.filter(s=>!q || s.title.toLowerCase().includes(q) || s.cwd.toLowerCase().includes(q));
      box.replaceChildren();
      if(!shown.length) box.append(el("div","lbl", sessions.length ? "No session matches." : "No sessions yet for this account."));
      shown.forEach(s=>{ const b = el("button",null,s.title); b.type="button"; b.title = s.cwd;
        b.append(el("span","when", s.cwd.split(/[\\/]/).pop()+" · "+ago(s.mtime)));
        b.onclick=async()=>{ try{ await api("/api/resume",{name:p.name,id:s.id,cwd:s.cwd}); $("dlg5").close(); toast("Resuming…"); }catch(e){ toast(e.message); } };
        box.append(b); });
    };
    $("d5q").oninput = draw; draw();
  }catch(e){ box.replaceChildren(el("div","err",e.message)); }
}
$("close5").onclick=()=>$("dlg5").close();
function openShare(p){
  $("d3title").textContent = 'Shared settings · '+p.name; $("err3").textContent = "";
  const box = $("d3list"); box.replaceChildren();
  const cur = lastState.profiles.find(x=>x.name===p.name).shared;
  items.forEach(it=>{
    const l = el("label","check"); const c = document.createElement("input"); c.type="checkbox"; c.checked = !!cur[it.id];
    c.onchange = async()=>{ try{ await api("/api/share",{name:p.name,item:it.id,on:c.checked}); $("err3").textContent=""; }
      catch(x){ c.checked=!c.checked; $("err3").textContent=x.message; } };
    l.append(c, it.label); box.append(l);
  });
  $("dlg3").showModal();
}
$("close3").onclick=()=>{ $("dlg3").close(); render(); };
function fillRecent(box, input){
  box.replaceChildren();
  if(!recent.length) return;
  box.append(el("div","lbl","Recent folders"));
  recent.forEach(d=>{ const b=el("button",null,d); b.type="button"; b.title=d; b.onclick=()=>{ input.value=d; input.focus(); }; box.append(b); });
}
function askFolder(p){
  folderFor = p; $("d2title").textContent = 'Open Claude as "'+p.name+'"';
  $("d2dir").value = p.workDir || ""; $("err2").textContent = ""; $("d2bind").checked = false;
  fillRecent($("d2recent"), $("d2dir")); $("dlg2").showModal(); $("d2dir").focus();
}
$("cancel2").onclick=()=>$("dlg2").close();
$("form2").onsubmit=async(e)=>{
  e.preventDefault();
  try{ await api("/api/open",{name:folderFor.name, workDir:$("d2dir").value.trim(), bind:$("d2bind").checked}); $("dlg2").close(); toast("Opening terminal…"); render(); }
  catch(x){ $("err2").textContent=x.message; }
};

async function render(){
  const d = await api("/api/state");
  recent = d.recent || []; items = d.items || []; lastState = d;
  $("sub").textContent = "v" + d.version + " · " + d.platform + " · " + d.count + " account" + (d.count===1?"":"s");
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
    const av = el("div","avatar",p.name[0].toUpperCase()); av.style.background=p.color||colorFor(p.name);
    const m = el("div","meta"); const n = el("div","name",p.name);
    if(p.active) n.append(el("span","pill","ACTIVE"));
    if(!p.loggedIn) n.append(el("span","pill warn","NOT SIGNED IN"));
    else if(p.loginExpired) n.append(el("span","pill warn","LOGIN EXPIRED"));
    if(p.plan) n.append(el("span","pill warn",p.plan.toUpperCase()));
    m.append(n, el("div","email",(p.email || (p.loggedIn ? "Signed in" : "Sign in to link an account")) + (p.org && p.org !== p.email ? " · "+p.org : "")));
    if(p.note) m.append(el("div","note",p.note));
    const act = el("div","act"); act.dataset.name = p.name; m.append(act);
    const chips = el("div","chips");
    const mk = (ok,label)=>{ const c=el("span","chip "+(ok?"ok":"todo")); c.append(el("i"), label); return c; };
    chips.append(mk(p.loggedIn,"Claude Code"), mk(p.chrome.extensionInstalled,"Chrome extension"));
    m.append(chips);
    m.append(el("div","email","Folder: "+(p.workDir || "home (default)")));
    if(p.bindings.length){
      const bx = el("div","chips"); bx.append(el("span","email","Auto-used in:"));
      p.bindings.forEach(dir=>{ const ch = el("span","chip ok"); ch.title = dir; ch.append(el("i"), dir+" ");
        const x = el("button","ghost","×"); x.title="Unbind"; x.style.padding="0 4px";
        x.onclick=async()=>{ try{ await api("/api/unbind",{dir}); render(); }catch(e){ toast(e.message); } };
        ch.append(x); bx.append(ch); });
      m.append(bx);
    }
    const a = el("div","actions");
    if(!p.active) a.append(btn("Switch to this","primary",async()=>{ await api("/api/use",{name:p.name}); toast("Now using "+p.name); render(); }));
    a.append(btn("Open Claude","",async()=>{ askFolder(p); }));
    a.append(btn(p.loggedIn&&!p.loginExpired&&p.chrome.extensionInstalled?"Re-login":"Sign in","ghost",async()=>{ await api("/api/signin",{name:p.name}); toast("Sign in: /login in the terminal, claude.ai in Chrome"); }));
    a.append(btn("Usage","ghost",async()=>{ await api("/api/usage",{name:p.name}); toast("Opening claude.ai usage in "+p.name+"'s Chrome profile…"); }));
    a.append(btn("Sessions","ghost",async()=>openSessions(p)));
    a.append(btn("Shared","ghost",async()=>openShare(p)));
    a.append(btn("Settings","ghost",async()=>openSettings(p)));
    a.append(btn("Chrome","ghost",async()=>{ await api("/api/chrome",{name:p.name}); toast("Opening Chrome profile…"); }));
    a.append(btn("Remove","ghost danger",async()=>{ if(!confirm('Remove "'+p.name+'" and its saved login?')) return; await api("/api/remove",{name:p.name}); toast("Removed "+p.name); render(); }));
    c.append(av,m,a); list.append(c);
  });
  fillActivity(++renderId);
  const tip = $("tip");
  tip.replaceChildren("Switching changes the account used by every new ", el("code",null,"claude")," in your terminals once the shell hook is installed (", el("code",null,"ccaccounts install"),"). Already-running sessions keep their account. Claude Code and the Chrome extension must be signed in to the same claude.ai account to connect.");
}

$("add").onclick=()=>{ $("newname").value=""; $("newdir").value=""; $("err").textContent=""; fillRecent($("newrecent"), $("newdir"));$("dlg").showModal(); $("newname").focus(); };
$("cancel").onclick=()=>$("dlg").close();
$("form").onsubmit=async(e)=>{
  e.preventDefault();
  try{ const name=$("newname").value.trim(); await api("/api/add",{name, withChrome: $("withChrome").checked, workDir: $("newdir").value.trim()}); $("dlg").close(); toast("Created "+name+" — finish signing in in the terminal and Chrome"); render(); }
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
      if (req.method === 'GET' && req.url === '/favicon.png') return send(res, 200, icon.png(64), 'image/png');

      if (req.headers['x-token'] !== token) return send(res, 401, { error: 'Unauthorized' });

      if (req.method === 'GET' && req.url === '/api/state') {
        const binds = core.getBindings();
        const profiles = core.listProfiles().map((p) => ({ ...p, chrome: chrome.status(p.name), shared: share.status(p.name),
          bindings: binds.filter((b) => b.name === p.name).map((b) => b.dir) }));
        const names = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
        return send(res, 200, { profiles, recent: core.getRecent(), items: share.ITEMS, win: process.platform === 'win32', version: require('../package.json').version, count: profiles.length, platform: names[process.platform] || process.platform });
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        const { name, withChrome, workDir, bind, dir, item, on } = body;
        if (req.url === '/api/settings') { return send(res, 200, core.updateSettings(name, body.settings || {})); }
        if (req.url === '/api/sessions') {
          const limit = Math.min(Math.max(Number(body.limit) || 8, 1), 100);
          return send(res, 200, { sessions: sessions.listSessions(name, limit) });
        }
        if (req.url === '/api/usage') {
          if (!core.exists(name)) throw new Error('No such account');
          chrome.openProfile(name, { install: false, url: chrome.USAGE_URL });
          return send(res, 200, { ok: true });
        }
        if (req.url === '/api/update-check') { return send(res, 200, await update.checkUpdate()); }
        if (req.url === '/api/update-apply') { return send(res, 200, await update.applyUpdate()); }
        if (req.url === '/api/activity') { return send(res, 200, await activity.activity(name)); }
        if (req.url === '/api/resume') {
          const { id, cwd } = body;
          if (!core.exists(name)) throw new Error('No such account');
          if (!sessions.ID_RE.test(id || '')) throw new Error('Bad session id');
          // cwd comes from a session file; only use it if it is a real folder and is safe to put in a script
          let d = cwd; try { if (!fs.statSync(d).isDirectory() || /["\r\n%]/.test(d)) throw 0; } catch { d = core.launchDir(name); }
          openTerminal(name, d, `--resume ${id}`);
          return send(res, 200, { ok: true });
        }
        if (req.url === '/api/share') { share.setShared(name, item, !!on); return send(res, 200, { ok: true }); }
        if (req.url === '/api/unbind') { core.unbindFolder(dir); return send(res, 200, { ok: true }); }
        if (req.url === '/api/use') { core.setActive(name); return send(res, 200, { ok: true }); }
        if (req.url === '/api/add') {
          core.createProfile(name);
          try { core.setWorkDir(name, workDir); } catch (e) { core.removeProfile(name); throw e; }
          openTerminal(name, core.launchDir(name)); if (withChrome) chrome.openProfile(name); return send(res, 200, { ok: true });
        }
        if (req.url === '/api/workdir') { return send(res, 200, { workDir: core.setWorkDir(name, workDir) }); }
        if (req.url === '/api/chrome') { if (!core.exists(name)) throw new Error('No such account'); chrome.openProfile(name); return send(res, 200, { ok: true }); }
        if (req.url === '/api/signin') { if (!core.exists(name)) throw new Error('No such account'); openTerminal(name, core.launchDir(name)); if (withChrome !== false) chrome.openProfile(name); return send(res, 200, { ok: true }); }
        if (req.url === '/api/open') {
          if (!core.exists(name)) throw new Error('No such account');
          if (typeof workDir === 'string') core.setWorkDir(name, workDir); // remember the choice as current
          if (bind) { if (!core.getWorkDir(name)) throw new Error('Enter a folder to bind'); core.bindFolder(name, core.getWorkDir(name)); }
          openTerminal(name, core.launchDir(name)); return send(res, 200, { ok: true });
        }
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
