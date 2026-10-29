---
description: Switch the active ccaccounts account for new claude runs
argument-hint: <account name>
allowed-tools: Bash(ccaccounts use:*), Bash(ccaccounts list:*)
---

Run `ccaccounts use $ARGUMENTS`. If no name was given, run `ccaccounts list` and ask which account to use.

After switching, tell the user this session keeps its current account; the change applies to the next `claude` they start.
