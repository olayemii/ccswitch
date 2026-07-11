---
title: Common errors
description: Quick fixes for common ccswitch errors
---

## "Unknown profile: <name>"

The profile doesn't exist. Check available profiles:

```bash
ccswitch list
```

## "No ANTHROPIC_API_KEY in settings to snapshot"

Running `ccswitch save <name> --type api-key` but there's no API key in your current `settings.json`. Either add one to settings first, or use `ccswitch add` for guided setup.

## "No AWS_BEARER_TOKEN_BEDROCK in environment to snapshot"

Running `ccswitch save <name> --type bedrock-key` but the env var isn't set. Export it first:

```bash
export AWS_BEARER_TOKEN_BEDROCK=<your-token>
ccswitch save <name> --type bedrock-key
```

## "Active profile '<name>' is an api-key, but settings.json has no apiKeyHelper"

The settings file is out of sync with the active profile. Re-switch to fix:

```bash
ccswitch <name>
```

## "API key for '<name>' is invalid or revoked (HTTP 401)"

The stored API key no longer works. Generate a new one at console.anthropic.com and re-create the profile:

```bash
ccswitch remove <name>
ccswitch add
```
