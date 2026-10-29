# Changelog

## 1.1.2
- Fix: on a phone, accounts with long emails, organisation names or folder paths made the cards wider than the screen. They now wrap, and the phone header keeps its title on one line.
- The desktop header (title, buttons and Add account) now fits on one row; narrower windows stack it instead of squeezing it.

## 1.1.1
- Fix: a phone that scanned the QR code could land on "This phone is not paired". The pairing cookie is now `SameSite=Lax`, so it survives the redirect when the link is opened from a camera or scanner app.

## 1.1.0
- Phone-friendly layout.
- Optional phone access: the Phone button (or `ccaccounts ui --lan`) turns it on and shows a QR code, and it can be turned off again while running; a paired phone on the same network can see accounts and switch the active one on the computer. Off by default, one-time pairing, private networks only, limited to a short list of safe calls.
- Built-in QR encoder (still no dependencies).

## 1.0.1
- Published to npm as `@suhailaleryani/ccaccounts` (the command is still `ccaccounts`); releases are published from GitHub Actions with npm trusted publishing.
- Claude Code plugin with `/accounts` and `/switch-account` commands.

## 1.0.0
- Account switcher with web UI, desktop-style window and CLI.
- Per-folder accounts, shared settings, Claude in Chrome profile per account.
- Terminal dialog to install or remove shell wrappers (including cmd.exe).
- Update button that follows GitHub installs.
