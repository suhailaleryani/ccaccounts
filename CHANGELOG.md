# Changelog

## 1.1.0
- Phone-friendly layout.
- Optional phone access: `ccaccounts ui --lan` (or the Phone button) shows a QR code; a paired phone on the same network can see accounts and switch the active one on the computer. Off by default, one-time pairing, private networks only, limited to a short list of safe calls.
- Built-in QR encoder (still no dependencies).

## 1.0.1
- Published to npm as `@suhailaleryani/ccaccounts` (the command is still `ccaccounts`); releases are published from GitHub Actions with npm trusted publishing.
- Claude Code plugin with `/accounts` and `/switch-account` commands.

## 1.0.0
- Account switcher with web UI, desktop-style window and CLI.
- Per-folder accounts, shared settings, Claude in Chrome profile per account.
- Terminal dialog to install or remove shell wrappers (including cmd.exe).
- Update button that follows GitHub installs.
