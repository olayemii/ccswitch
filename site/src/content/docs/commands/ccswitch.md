---
title: ccswitch
description: Global profile switch command
---

## Synopsis

```
ccswitch [name] [--no-check]
```

## Description

Switches the active Claude Code profile for the entire machine. Without a name, shows an interactive picker. Patches `settings.json`, applies credentials to the keychain/store, and writes the active-profile pointer.

After switching, restart the desktop app or IDE — they cache tokens in memory.

## Options

| Option | Description |
|--------|-------------|
| `--no-check` | Skip the automatic credential liveness probe (Bedrock SigV4 / Anthropic API key) |

## Behavior

- **Bedrock-key profiles:** blocks if the token is expired; warns if expiring
- **API-key profiles:** probes the Anthropic API to verify the key is valid (unless `--no-check`)
- **Bedrock (SigV4) profiles:** runs `aws sts get-caller-identity` to verify credentials (unless `--no-check`)
- **Isolated config profiles:** prints a warning that isolation only applies per-shell via `ccuse`

## Examples

```bash
ccswitch work              # switch to 'work' globally
ccswitch                   # interactive picker
ccswitch work --no-check   # skip liveness probe
```

## Related

- [ccswitch env / ccuse](/docs/commands/env) — per-shell switching
- [ccswitch doctor](/docs/commands/doctor) — diagnose active profile
