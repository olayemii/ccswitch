---
title: API key
description: Using an Anthropic API key as a profile
---

An `api-key` profile stores an Anthropic API key (`sk-ant-…`). Claude Code reads it via the `apiKeyHelper` mechanism on global switch, or `ANTHROPIC_API_KEY` env var for per-shell.

## When to use

- You have an API key from console.anthropic.com
- You want different keys for different projects or billing contexts

## Setup

```bash
ccswitch add
# choose "API key", paste your key
```

Or snapshot from current settings:

```bash
ccswitch save work --type api-key
```

## Liveness check

On global switch, ccswitch probes the Anthropic API to verify the key is valid. If it returns 401, you'll see an error. Skip with `--no-check`.

## What gets stored

- API key → OS keychain
- On global switch: `settings.json` gets an `apiKeyHelper` command that reads the key from the keychain at runtime
