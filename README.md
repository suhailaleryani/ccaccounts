# ccswitch

> Unofficial community tool. Not affiliated with or endorsed by Anthropic. "Claude" and "Claude Code" are Anthropic trademarks.

Switch between multiple Claude Code accounts from a web UI or the command line.
Works on Windows, macOS and Linux (Node 18+).

Each account is a separate `CLAUDE_CONFIG_DIR` under `~/.ccswitch/profiles/<name>`.
Picking an account makes every new `claude` command use that account's login.

## Install

```bash
cd ccswitch
npm install -g .
ccswitch install        # adds a `claude` wrapper to your shell profile, then open a new terminal
```

## Claude in Chrome

`ccswitch add <name>` (or the UI's **Add account**) also opens a dedicated Chrome profile for that account on claude.ai and the extension's store page, so each account gets its own extension login. Claude Code only connects to the extension when both are signed in to the **same claude.ai account and organization**. ccswitch can see whether the extension is installed in the profile, but not whether it is signed in. Run `/chrome` inside Claude Code to check the connection. Use `--no-chrome` to skip this step.

## Use

```bash
ccswitch ui             # open the account picker in your browser
ccswitch import main    # adopt the login you already have
ccswitch add work       # new account; type /login in the window that opens
ccswitch use work       # switch (or click "Switch to this" in the UI)
ccswitch whoami
ccswitch run personal -p "hello"   # one-off as another account
```

`ccswitch help` lists everything.

## Shells

| Shell | How |
|---|---|
| bash, zsh, fish, PowerShell | `ccswitch install` |
| cmd.exe | can't define functions; type `ccswitch claude` instead of `claude` |
| IDEs / other tools | `ccswitch env` prints the line that sets `CLAUDE_CONFIG_DIR` |

## Limits

- Already-running `claude` sessions keep the account they started with.
- macOS stores the OAuth token in the Keychain, so `import` copies settings but you run `ccswitch login <name>` once per account.
- Use this for accounts that are yours (work/personal). It is not for getting around usage limits.

## Security

The UI listens on `127.0.0.1` only, rejects non-localhost `Host` headers, and requires a random per-run token on every API call.

## Contributing

Issues and PRs welcome. The Windows and macOS code paths (terminal launcher, PowerShell profile install, Chrome launch) have had the least real-world testing, so reports from those platforms are especially useful. Run `npm test` before opening a PR.

## License

MIT

## Tests

```bash
npm test
```
CI runs on Ubuntu, macOS and Windows (`.github/workflows/test.yml`).
