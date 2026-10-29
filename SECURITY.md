# Security

ccaccounts is an unofficial community tool. It stores each account's Claude Code login under `~/.ccaccounts/profiles/<name>` (a separate `CLAUDE_CONFIG_DIR`), the same files Claude Code itself writes.

- The UI listens on `127.0.0.1` only.
- Logins are never sent anywhere by ccaccounts. It makes no network calls except the optional update check against GitHub/npm when you press the update button.
- No runtime dependencies.

To report a vulnerability, use GitHub's private "Report a vulnerability" under the Security tab, not a public issue.
