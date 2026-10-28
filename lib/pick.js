'use strict';
// "Which account for this run?" prompt shown by the `claude` wrapper when `ccaccounts ask on` is set.
// The prompt goes to stderr and reads stdin, because stdout is captured by the shell wrapper.
const readline = require('readline');

// Subcommands and flags that never start an interactive session: no point asking.
const SUBCOMMANDS = new Set(['mcp', 'config', 'update', 'upgrade', 'doctor', 'install', 'migrate-installer', 'setup-token',
  'plugin', 'plugins', 'agents', 'auth', 'login', 'logout', 'api-key', 'completion', 'help']);
const PRINT_FLAGS = new Set(['-p', '--print', '-v', '--version', '-h', '--help']);

function isInteractiveRun(args) {
  if (args.some((a) => PRINT_FLAGS.has(a))) return false;
  return !(args[0] && SUBCOMMANDS.has(args[0]));
}

// Number, or the account name (case-insensitive); blank means the default.
function parseAnswer(answer, profiles, def) {
  const a = answer.trim();
  if (!a) return def;
  if (/^\d+$/.test(a)) { const p = profiles[Number(a) - 1]; return p ? p.name : null; }
  const p = profiles.find((x) => x.name.toLowerCase() === a.toLowerCase());
  return p ? p.name : null;
}

// Resolves to the chosen name, or null if the user aborted (Ctrl+C / Ctrl+D / three bad answers).
function choose(profiles, def, { input = process.stdin, output = process.stderr } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input, output, terminal: !!(input.isTTY && output.isTTY) });
    let done = false, tries = 0;
    const finish = (v) => { if (!done) { done = true; rl.close(); resolve(v); } };
    output.write('\nWhich Claude account for this session?\n');
    profiles.forEach((p, i) => output.write(`  ${i + 1}) ${p.name}${p.email ? '  ' + p.email : ''}${p.name === def ? '   (default)' : ''}\n`));
    const ask = () => rl.question(`Choose [1-${profiles.length}${def ? ', Enter = ' + def : ''}]: `, (ans) => {
      const n = parseAnswer(ans, profiles, def);
      if (n) return finish(n);
      if (++tries >= 3) return finish(null);
      output.write('  Not an account. Try again.\n'); ask();
    });
    rl.on('close', () => finish(null)); // Ctrl+D / closed input
    rl.on('SIGINT', () => finish(null));
    ask();
  });
}

module.exports = { isInteractiveRun, parseAnswer, choose };
