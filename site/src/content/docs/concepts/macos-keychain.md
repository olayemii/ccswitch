---
title: macOS keychain caveat
description: Why login profiles need a token for per-shell use
---

On macOS, subscription logins are stored in the encrypted login keychain — a single global slot. It cannot be scoped per-shell or per-`CLAUDE_CONFIG_DIR`.

## The problem

Two different login accounts cannot be simultaneously "live" via the keychain. The global switch overwrites the keychain entry, so only one login profile is active at a time globally.

## The solution: captured tokens

For per-shell parallelism with login profiles, capture a long-lived OAuth token:

```bash
ccswitch token <name>
```

This runs `claude setup-token` and stores the result in the secret store under a separate slot. Then `ccuse <name>` exports `CLAUDE_CODE_OAUTH_TOKEN` into the shell, bypassing the keychain entirely.

## Platform note

This requirement applies to **all platforms**, not just macOS. The `ccswitch env` command always requires a captured token for login profiles, because per-shell mode works via environment variables — not by redirecting which keychain/credential file is read.
