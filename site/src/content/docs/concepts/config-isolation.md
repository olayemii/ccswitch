---
title: Config isolation
description: Give each profile its own settings, history, and MCP config
---

By default, all profiles share one `~/.claude` directory — same settings, same history, same MCP servers. Config isolation gives a profile its own copy.

## What's isolated

When a profile has an isolated config dir (`~/.ccswitch/homes/<name>/`):
- `settings.json` — separate permissions, model, theme
- MCP server config — different servers per profile
- Conversation history — sessions don't bleed across profiles
- Project data — CLAUDE.md overrides, project memory

## What's NOT isolated

- Keychain secrets — stored by profile name in the OS keychain, not in the config dir
- The ccswitch profiles themselves — live in `~/.ccswitch/`

## Setup

During `ccswitch add`, answer "yes" to the isolation prompt. Your current `~/.claude` (minus `.credentials.json`) is copied as a starting point — then it diverges independently.

## Important: per-shell only

Isolation is carried by the `CLAUDE_CONFIG_DIR` environment variable, so it only works via `ccuse <name>` (per-shell). A global switch (`ccswitch <name>`) cannot set env vars for the desktop app, so it uses the shared config and warns you.
