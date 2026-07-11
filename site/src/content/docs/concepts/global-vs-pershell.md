---
title: Global vs per-shell switching
description: Understand the two switching modes
---

ccswitch offers two ways to activate a profile:

## Global switch (`ccswitch <name>`)

Changes the active profile for the entire machine:
- Patches `~/.claude/settings.json`
- Writes/removes credentials in the keychain
- Updates the active-profile pointer

The CLI, desktop app, and IDE extensions all read from this shared state. After switching, restart the desktop app/IDE (they cache tokens in memory).

Only one global profile is active at a time.

## Per-shell switch (`ccuse <name>`)

Sets environment variables in the current terminal only:
- `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `AWS_BEARER_TOKEN_BEDROCK`, etc.
- Optionally `CLAUDE_CONFIG_DIR` for isolated config

Nothing global changes. Different terminals can run different profiles simultaneously. The desktop app and IDE are unaffected.

## When to use which

| Scenario | Use |
|----------|-----|
| Day-to-day single-account usage | Global switch |
| Running two accounts in parallel | Per-shell |
| Testing a new profile without disrupting the desktop app | Per-shell |
| Switching on a machine with no terminal access (IDE only) | Global switch |
