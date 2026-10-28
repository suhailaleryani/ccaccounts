# ccaccounts

> Unofficial community tool. Not affiliated with or endorsed by Anthropic. "Claude" and "Claude Code" are Anthropic trademarks.

Switch between multiple Claude Code accounts from a web UI or the command line.
Works on Windows, macOS and Linux (Node 18+).

Each account is a separate `CLAUDE_CONFIG_DIR` under `~/.ccaccounts/profiles/<name>`.
Picking an account makes every new `claude` command use that account's login.

## Install

```bash
cd ccaccounts
npm install -g .
ccaccounts install        # adds a `claude` wrapper to your shell profile, then open a new terminal
```

## Claude in Chrome

`ccaccounts add <name>` (or the UI's **Add account**) also opens a dedicated Chrome profile for that account on claude.ai and the extension's store page, so each account gets its own extension login. Claude Code only connects to the extension when both are signed in to the **same claude.ai account and organization**. ccaccounts can see whether the extension is installed in the profile, but not whether it is signed in. Run `/chrome` inside Claude Code to check the connection. Use `--no-chrome` to skip this step.

## Use

```bash
ccaccounts ui             # open the account picker in your browser
ccaccounts import main    # adopt the login you already have
ccaccounts add work       # new account; type /login in the window that opens
ccaccounts use work       # switch (or click "Switch to this" in the UI)
ccaccounts whoami
ccaccounts run personal -p "hello"   # one-off as another account
```

`ccaccounts help` lists everything.

## Work folder

Each account has a work folder: where its terminal starts. In the UI, **Open Claude** asks for the folder, pre-filled with the account's current one, with your recent folders listed to click. The folder you open with becomes the account's current one. A blank folder means your home folder. The **Add account** dialog has the same field.

```bash
ccaccounts add work --dir D:\Projects\myapp   # set at creation
ccaccounts dir work                           # show
ccaccounts dir work D:\Projects\other         # change (no path argument shows it; use "" to clear)
```

If the saved folder is later deleted, the terminal starts in your home folder instead.

## Folder → account

Bind a folder to an account and `claude` run in that folder (or any folder below it) uses that account, with no manual switching. The deepest bound folder wins; anywhere else uses the active account.

```bash
ccaccounts bind work D:\Projects\clientA   # or: cd there and run `ccaccounts bind work`
ccaccounts bind                            # list bindings
ccaccounts unbind D:\Projects\clientA
ccaccounts whoami                          # account in effect in the current folder
```

In the UI, tick **Always use this account in this folder** in the Open Claude dialog; bound folders show on the card with a × to unbind. This works through the shell wrapper (`ccaccounts install`) or `ccaccounts claude`.

## Shared settings

A new account starts empty. Share `CLAUDE.md`, `settings.json`, `skills`, `agents` or `commands` so every account that opts in uses one copy:

```bash
ccaccounts share work            # show what is shared
ccaccounts share work skills     # share (use "off" to stop)
```

The first account to share an item donates its copy; later accounts keep their own version beside the link as `<item>.backup-<time>`. Turning sharing off gives that account a private copy. Items are symlinks (directories use junctions on Windows, so no admin rights are needed; files fall back to a hard link). Sharing `settings.json` also shares anything account-specific in it, so check it first. Deleting an account never touches the shared copy. The UI has a **Shared** button per account.

## Account settings, health and sessions

- **Settings** (UI button, or `ccaccounts set <name> <note|color|args|terminal> <value>`): a note, an avatar colour, extra options passed to `claude` when the UI opens a terminal (for example `--model opus`), and on Windows the terminal to use: Command Prompt (default), PowerShell or Windows Terminal. Extra options accept plain flags only (no `; & | " < >`).
- **Health:** each card shows the plan (from the saved login) and the organisation, and flags **LOGIN EXPIRED** when the saved login can no longer renew itself. An expired access token alone is normal, since Claude Code refreshes it. Your tokens are never sent to the page.
- **Sessions** (UI button, or `ccaccounts sessions <name>`): the account's recent conversations. Click one to continue it in a new terminal (`claude --resume`).

## Desktop app

```bash
ccaccounts app            # the UI in its own window (no tabs or address bar)
ccaccounts shortcut       # add a Start Menu launcher (Windows), ~/Applications app (macOS) or .desktop entry (Linux)
ccaccounts shortcut remove
ccaccounts autostart      # optional: open the window when you sign in ("autostart off" to undo)
```

`app` needs Chrome or Edge (Edge is tried first on Windows; set `CCACCOUNTS_BROWSER` to use another Chromium browser). It runs in its own browser profile, so it doesn't touch your Chrome accounts, and closing the window stops the local server. The shortcut uses the ccaccounts icon and is also placed on your real Desktop folder, even when OneDrive has moved it. The macOS and Linux launchers have had little real-world testing. There is no tray icon; that would need a bundled runtime such as Electron.

## Shells

| Shell | How |
|---|---|
| bash, zsh, fish, PowerShell | `ccaccounts install` |
| cmd.exe | can't define functions; type `ccaccounts claude` instead of `claude` |
| IDEs / other tools | `ccaccounts env` prints the line that sets `CLAUDE_CONFIG_DIR` |

## Limits

- Already-running `claude` sessions keep the account they started with.
- macOS stores the OAuth token in the Keychain, so `import` copies settings but you run `ccaccounts login <name>` once per account.
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
