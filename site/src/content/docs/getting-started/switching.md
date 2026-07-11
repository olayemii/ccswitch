---
title: Switching profiles
description: Switch between profiles globally or per-shell
---

## Global switch

```bash
ccswitch work
```

This changes the active profile for the entire machine — CLI, desktop app, and IDE extensions all follow it. You'll need to restart the desktop app or IDE to pick up the change (they cache the token in memory).

## Interactive picker

Run `ccswitch` with no arguments to get an interactive menu:

```bash
ccswitch
```

## Per-shell switch

To switch only the current terminal (leaving other terminals and the desktop app unchanged):

```bash
ccuse work
```

This exports the right environment variables for that profile into your current shell. Different terminals can use different profiles simultaneously.

To clear the per-shell override:

```bash
ccuse --unset
```

:::note
Per-shell switching requires shell setup — see [Shell setup (ccuse)](/docs/getting-started/shell-setup).
:::
