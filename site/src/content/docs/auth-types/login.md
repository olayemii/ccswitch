---
title: Login (subscription)
description: Using a Claude subscription login as a profile
---

A `login` profile uses your Claude subscription credential — the same thing you get when you run `claude auth login` or sign in through the desktop app.

## When to use

- You have a Claude Pro/Team/Enterprise subscription
- You want to switch between multiple subscription accounts (e.g. personal vs work org)

## Setup

```bash
ccswitch add
# choose "Login", follow the auth flow
```

Or snapshot the currently logged-in credential:

```bash
ccswitch save personal --type login
```

## Per-shell use

Login profiles require a captured OAuth token for per-shell switching:

```bash
ccswitch token personal    # one-time capture
ccuse personal             # now works in this shell
```

See [macOS keychain caveat](/docs/concepts/macos-keychain) for why.

## What gets stored

- Credential blob → OS keychain (secret slot)
- OAuth token → OS keychain (token slot, if captured)
- Account email/org → profile JSON (for display in `doctor`)
