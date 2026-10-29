---
description: List ccaccounts accounts and show which one is active
allowed-tools: Bash(ccaccounts list:*), Bash(ccaccounts whoami:*)
---

Run `ccaccounts whoami` and `ccaccounts list`, then report the account in effect here and the other accounts available. If the command is not found, tell the user to install it with `npm install -g github:suhailaleryani/ccaccounts`.

Note: the account of the running session cannot change; switching only affects new `claude` runs.
