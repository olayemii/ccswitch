---
title: ccswitch token
description: Capture an OAuth token for per-shell login
---

## Synopsis

```
ccswitch token <name>
```

## Description

Captures a long-lived OAuth token (via `claude setup-token`) for a login profile. This is required for per-shell switching with login profiles — without a token, `ccswitch env <name>` will refuse.

The token is stored in the OS secret store, not on disk.

## Why is this needed?

On all platforms, per-shell login switching works by exporting `CLAUDE_CODE_OAUTH_TOKEN` into the shell. The live keychain credential is a single global slot that can't be scoped per-shell — so a separate captured token is needed.

## Examples

```bash
ccswitch token personal
# → launches claude setup-token, stores result

ccuse personal
# → now works (exports CLAUDE_CODE_OAUTH_TOKEN)
```

## Related

- [Per-shell login token](/docs/troubleshooting/pershell-token) — troubleshooting
- [macOS keychain caveat](/docs/concepts/macos-keychain) — why the keychain can't be shared
