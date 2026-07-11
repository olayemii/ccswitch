---
title: Desktop app didn't pick up the switch
description: Fix the desktop app not reflecting a global switch
---

## Problem

After running `ccswitch <name>`, the desktop app or IDE extension still uses the old account.

## Cause

The desktop app and IDE extensions cache the authentication token in memory. A global switch updates the on-disk config and keychain, but running processes don't re-read until restarted.

## Fix

Restart the desktop app or IDE extension after a global switch.

If you're switching frequently and don't want to restart:
- Use per-shell switching (`ccuse <name>`) with the CLI — it takes effect immediately in that terminal
- The desktop app will continue using whatever global profile was last switched to
