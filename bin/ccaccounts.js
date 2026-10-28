#!/usr/bin/env node
'use strict';
const core = require('../lib/core');
const shell = require('../lib/shell');
const chrome = require('../lib/chrome');

const die = (m) => { console.error(m); process.exit(1); };
const [cmd, ...args] = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return null; return args.splice(i, 2)[1] || ''; };

const HELP = `ccaccounts - switch between multiple Claude Code accounts

  ui [--port N]     open the web UI (account picker)
  app               open the UI as a standalone desktop-style window (needs Chrome or Edge)
  shortcut [remove] add (or remove) a Start Menu / Desktop / Applications launcher for \`app\`
  list [--json]     list accounts (* = active)
  use <name>        switch the active account for all new \`claude\` runs
  add <name> [--dir <path>]  create an account; signs in to Claude Code AND Claude in Chrome
  dir <name> [path]  show or set the account's work folder (UI "Open Claude" starts there)
  login <name>      sign in again (Claude Code + Chrome)
  chrome <name>     open this account's Chrome profile (claude.ai login + extension)
  import <name>     adopt your existing Claude Code login as an account
  whoami            show the active account
  run <name> ...    run claude once as another account
  claude ...        run claude as the active account (works in cmd.exe)
  remove <name>     delete an account and its saved login
  install [shell]   add the claude wrapper to your shell profile
  uninstall [shell] remove it
  hook [shell]      print the wrapper (bash, zsh, fish, powershell)
  env [shell]       print the line that sets CLAUDE_CONFIG_DIR (for IDEs/scripts)`;

function openChrome(name) {
  chrome.openProfile(name);
  console.log(`Opened Chrome profile "${chrome.profileDirName(name)}".
  1. Sign in to claude.ai with the SAME account you use for Claude Code "${name}".
  2. Install "Claude in Chrome" if the store tab opened, then sign in inside the extension.
  Claude Code only connects when both use the same account and organization.`);
}

// Step 1: Chrome (non-blocking). Step 2: Claude Code login (interactive, blocks until you exit).
function signIn(name, noChrome) {
  if (!noChrome) {
    try { openChrome(name); } catch (e) { console.error(`Skipping Chrome: ${e.message}`); }
  }
  console.log('\nLaunching Claude Code - type /login to sign in, then exit. Later, run `claude --chrome` (or /chrome) to link the extension.');
  process.exitCode = core.runClaude(name, []);
}

try {
  switch (cmd) {
    case 'ui': {
      const port = Number(flag('--port')) || 4455;
      require('../lib/ui').start({ port }).then(({ url }) => {
        console.log(`ccaccounts UI running at ${url}\nPress Ctrl+C to stop.`);
      }).catch((e) => die(e.message));
      break;
    }
    case 'app': {
      require('../lib/app').startApp().catch((e) => die(e.message));
      break;
    }
    case 'shortcut': {
      const app = require('../lib/app');
      if (args[0] === 'remove') {
        const r = app.removeShortcut();
        console.log(r.length ? 'Removed:\n  ' + r.join('\n  ') : 'Nothing to remove.');
      } else {
        console.log('Created:\n  ' + app.createShortcut().join('\n  ') + '\nLaunch "ccaccounts" like any other app.');
      }
      break;
    }
    case 'list': {
      const ps = core.listProfiles();
      if (args.includes('--json')) { console.log(JSON.stringify(ps, null, 2)); break; }
      if (!ps.length) { console.log('No accounts yet. Try: ccaccounts add <name>   (or: ccaccounts import <name>)'); break; }
      for (const p of ps) {
        const c = chrome.status(p.name);
        const cs = c.extensionInstalled ? 'chrome ext: installed' : c.profileExists ? 'chrome: profile, no extension' : 'chrome: not set up';
        console.log(`${p.active ? '*' : ' '} ${p.name}  ${p.email || (p.loggedIn ? '(signed in)' : '(not signed in)')}  [${cs}]`);
      }
      break;
    }
    case 'use': {
      core.setActive(args[0]);
      const p = core.listProfiles().find((x) => x.active);
      console.log(`Active account: ${p.name}${p.email ? ' (' + p.email + ')' : ''}`);
      break;
    }
    case 'whoami': {
      const p = core.listProfiles().find((x) => x.active);
      if (!p) die('No active account. Try: ccaccounts add <name>');
      console.log(`${p.name}${p.email ? '  ' + p.email : ''}`);
      break;
    }
    case 'add': {
      const noChrome = args.includes('--no-chrome');
      const dir = flag('--dir');
      const name = args.find((a) => !a.startsWith('--'));
      core.createProfile(name);
      if (dir) { try { core.setWorkDir(name, dir); } catch (e) { core.removeProfile(name); throw e; } }
      console.log(`Created "${name}".`);
      signIn(name, noChrome);
      break;
    }
    case 'dir': {
      if (!core.exists(args[0])) die(`No such account: ${args[0]}`);
      if (args.length > 1) console.log(`Work folder: ${core.setWorkDir(args[0], args[1]) || '(cleared)'}`);
      else console.log(core.getWorkDir(args[0]) || '(not set - uses home)');
      break;
    }
    case 'import': {
      const r = core.importDefault(args[0]);
      console.log(`Imported your existing login as "${args[0]}".`);
      if (r.needsLogin) console.log(`No login file found (macOS keeps it in the Keychain). Run: ccaccounts login ${args[0]}`);
      break;
    }
    case 'login': {
      const name = args.find((a) => !a.startsWith('--'));
      if (!core.exists(name)) die(`No such account: ${name}`);
      signIn(name, args.includes('--no-chrome'));
      break;
    }
    case 'chrome': {
      if (!core.exists(args[0])) die(`No such account: ${args[0]}`);
      openChrome(args[0]);
      break;
    }
    case 'run': { const n = args.shift(); process.exitCode = core.runClaude(n, args); break; }
    case 'claude': {
      const n = core.getActive();
      if (!n) die('No active account. Try: ccaccounts add <name>');
      process.exitCode = core.runClaude(n, args);
      break;
    }
    case 'remove': core.removeProfile(args[0]); console.log(`Removed "${args[0]}"`); break;
    case 'path': { const n = core.getActive(); if (n) console.log(core.profilePath(n)); break; }
    case 'hook': console.log(shell.hookFor(args[0] || shell.detectShell())); break;
    case 'env': {
      const n = core.getActive();
      if (!n) die('No active account');
      console.log(shell.envLine(args[0] || shell.detectShell(), core.profilePath(n)));
      break;
    }
    case 'install': {
      const files = shell.install(args[0] || shell.detectShell());
      console.log('Installed in:\n  ' + files.join('\n  ') + '\nOpen a new terminal for it to take effect.');
      break;
    }
    case 'uninstall': {
      const files = shell.uninstall(args[0] || shell.detectShell());
      console.log(files.length ? 'Removed from:\n  ' + files.join('\n  ') : 'Nothing to remove.');
      break;
    }
    default: console.log(HELP);
  }
} catch (e) {
  die(e.message);
}
