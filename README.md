# ccaccounts

> Unofficial community tool. Not affiliated with or endorsed by Anthropic. "Claude" and "Claude Code" are Anthropic trademarks.

**Use several Claude Code accounts side by side (work, personal, clients) and switch between them in one click.**

[![tests](https://github.com/suhailaleryani/ccaccounts/actions/workflows/test.yml/badge.svg)](https://github.com/suhailaleryani/ccaccounts/actions/workflows/test.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![node >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)

![ccaccounts web UI showing three Claude Code accounts with plan, notes, weekly activity and a More menu](https://raw.githubusercontent.com/suhailaleryani/ccaccounts/main/docs/screenshot.png)

Claude Code signs in to one account at a time. ccaccounts gives each account its own login and settings, so you can keep a work and a personal account (and a Claude in Chrome profile for each) without logging out and back in.

- **One-click switching** from a web UI, a desktop-style window or the command line; every new `claude` uses the account you picked.
- **Account per folder:** `claude` in a client's folder automatically uses that client's account.
- **Or be asked:** optionally choose the account each time you type `claude`.
- **Shared settings:** keep one `CLAUDE.md`, skills, agents and commands across accounts.
- **Claude in Chrome:** a dedicated Chrome profile per account, so the extension signs in to the same account.
- **See what each account is doing:** plan, 7-day activity, recent sessions you can resume, and a shortcut to claude.ai's usage page.
- **Safe and small:** no dependencies, listens on `127.0.0.1` only, never sends your login anywhere.

Works on Windows, macOS and Linux (Node 18+). Each account is a separate `CLAUDE_CONFIG_DIR` under `~/.ccaccounts/profiles/<name>`.

## Quick start

```bash
npm install -g @suhailaleryani/ccaccounts
ccaccounts install        # adds a `claude` wrapper to your shell profile; open a new terminal afterwards
ccaccounts ui             # open the account picker, then click "+ Add account"
```

Needs Node 18+. The command it installs is `ccaccounts`. To install the latest straight from GitHub instead (needs git): `npm install -g github:suhailaleryani/ccaccounts`. Prefer a local clone you can edit? `git clone https://github.com/suhailaleryani/ccaccounts && cd ccaccounts && npm install -g .`

## Claude Code plugin (optional)

Add `/accounts` and `/switch-account` slash commands inside Claude Code (needs the CLI installed first):

```
/plugin marketplace add suhailaleryani/ccaccounts
/plugin install ccaccounts@ccaccounts
```

Switching affects new `claude` runs, not the session you are in.

## Claude in Chrome

`ccaccounts add <name>` (or the UI's **Add account**) also opens a dedicated Chrome profile for that account on claude.ai and the extension's store page, so each account gets its own extension login. Claude Code only connects to the extension when both are signed in to the **same claude.ai account and organization**. ccaccounts can see whether the extension is installed in the profile, but not whether it is signed in. Run `/chrome` inside Claude Code to check the connection. Use `--no-chrome` to skip this step.

## Use

```bash
ccaccounts ui             # open the account picker in your browser
ccaccounts import main    # adopt the login you already have
ccaccounts add work       # new account; type /login in the window that opens
ccaccounts use work       # switch (or click "Switch to this" in the UI)
ccaccounts list           # all accounts (* = active)
ccaccounts whoami
ccaccounts remove old     # delete an account and its saved login
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
- **Sessions** (UI button, or `ccaccounts sessions <name>`): the account's 40 most recent conversations, searchable by prompt or folder. Click one to continue it in a new terminal (`claude --resume`).
- **Usage** (UI button, or `ccaccounts usage <name>`): opens claude.ai's usage page, where your weekly plan limits are, in that account's own Chrome profile (sign in there once). ccaccounts doesn't read or show the limit numbers itself: Claude Code keeps none on disk, and reading them would mean sending your login token to an undocumented Anthropic endpoint, which I chose not to do.
- **Activity:** each card shows replies and tokens for the last 7 days, with a bar per day and the most used model, read from the account's local session logs (cache reads are not counted). Claude Code doesn't store plan limits locally, so this shows what you used, not what is left. Results are cached by file, so after the first read it is instant.

## Updating

The UI header has two buttons: **Refresh** reloads the account list, and **Update** checks for a newer ccaccounts and installs it. From the terminal: `ccaccounts update` (or `ccaccounts update --check` to only look).

- **Installed from a git clone** (`npm install -g .`): it runs `git fetch` and, if there are new commits, `git pull --ff-only`. It refuses when the clone has uncommitted changes or local commits that aren't on the remote, and tells you why.
- **Installed with `npm install -g github:suhailaleryani/ccaccounts`:** it reads the latest version from the repo's `main` branch and, if newer, runs the same `npm install -g github:suhailaleryani/ccaccounts` again.
- **Installed from the npm registry**: it asks npm for the latest version and runs `npm install -g <package>@latest`.

Nothing is checked automatically: it only contacts GitHub or npm when you press the button or run the command. The dialog shows the exact command before anything is installed. Restart ccaccounts afterwards to use the new version.

## Ask which account when you run `claude`

```bash
ccaccounts ask on         # then re-run `ccaccounts install` once so the shell wrapper can ask
claude                    # -> "Which Claude account for this session?"  1) work  2) personal
ccaccounts ask off
```

Type a number or a name; Enter picks the default (the active account). Ctrl+C or Ctrl+D cancels, and `claude` does not start. The choice applies to that run only; it doesn't change the active account. It never asks for folders bound to an account, for non-interactive use (`claude -p`, `--version`, `mcp`, `config`, `update`, piped input) or when there is only one account.

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
| bash, zsh, fish, PowerShell | `ccaccounts install [shell]`, or the **Terminal** button in the UI (tick shells, Save) |
| cmd.exe | `ccaccounts install cmd` (or the Terminal button) adds a `doskey` macro through the Command Prompt AutoRun registry value; `ccaccounts uninstall cmd` removes it |
| IDEs / other tools | `ccaccounts env` prints the line that sets `CLAUDE_CONFIG_DIR` (it doesn't ask; it uses a bound folder's account or the active one) |

After updating ccaccounts, run `ccaccounts install` again so your shell gets the latest wrapper. `ccaccounts uninstall` removes it.

## Limits

- Already-running `claude` sessions keep the account they started with.
- macOS stores the OAuth token in the Keychain, so `import` copies settings but you run `ccaccounts login <name>` once per account.
- Use this for accounts that are yours (work/personal). It is not for getting around usage limits.

## Security

The UI listens on `127.0.0.1` only, rejects non-localhost `Host` headers, and requires a random per-run token on every API call.

## Contributing

Issues and PRs welcome. The code is exercised on Windows (launchers, shortcuts, junction sharing) and Linux (tests, shortcut, autostart and the bash wrapper, run under WSL). The macOS paths (app bundle, LaunchAgent, Terminal launcher, Keychain behaviour) and Windows Terminal have had no real-world testing, so reports from those are especially useful. Run `npm test` before opening a PR.

## License

MIT

## Tests

```bash
npm test
```
CI runs on Ubuntu, macOS and Windows (`.github/workflows/test.yml`).
