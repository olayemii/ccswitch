---
title: ccswitch save
description: Snapshot current live state into a profile
---

## Synopsis

```
ccswitch save <name> --type <login|api-key|bedrock|bedrock-key|custom> [--force]
```

## Description

Captures whatever Claude Code is currently configured with and saves it as a named profile — without going through the interactive wizard.

What it reads depends on `--type`:

| Type | Source |
|------|--------|
| `login` | Live `.credentials.json` from keychain |
| `api-key` | `ANTHROPIC_API_KEY` from `settings.json` |
| `bedrock` | `CLAUDE_CODE_USE_BEDROCK`, `AWS_PROFILE`, `AWS_REGION` from settings |
| `bedrock-key` | `AWS_BEARER_TOKEN_BEDROCK` from the environment |
| `custom` | `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` and any model overrides from `settings.json` |

`--type custom` is the one case where `save` writes as well as reads: the token is moved into the OS secret store and the plaintext copy is deleted from `settings.json`, so it can't outlive a later switch. Run `ccswitch <name>` afterwards to activate the profile and restore the token.

## Options

| Option | Description |
|--------|-------------|
| `--type <type>` | Required. Auth type to snapshot |
| `--force` | Overwrite an existing profile with the same name |

## Examples

```bash
ccswitch save work --type api-key
ccswitch save bedrock-prod --type bedrock-key
ccswitch save deepseek --type custom
ccswitch save personal --type login --force
```

## Related

- [ccswitch add](/docs/commands/add) — interactive guided setup
