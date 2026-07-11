---
title: Per-shell login requires a token
description: "Fix: Profile '<name>' has no captured OAuth token"
---

## Problem

Running `ccuse <name>` or `ccswitch env <name>` on a login profile gives:

```
Profile '<name>' has no captured OAuth token. Run: ccswitch token <name>
```

## Cause

Per-shell switching works by exporting environment variables. For login profiles, this requires a captured OAuth token (`CLAUDE_CODE_OAUTH_TOKEN`). The live keychain credential can't be scoped per-shell.

## Fix

Capture a token once:

```bash
ccswitch token <name>
```

This runs `claude setup-token` interactively and stores the result. After this, `ccuse <name>` will work.

## See also

- [macOS keychain caveat](/docs/concepts/macos-keychain) — why this is needed
