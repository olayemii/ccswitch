---
title: Your first profile
description: Create your first ccswitch profile
---

A profile captures everything Claude Code needs to authenticate as a specific account. Create one with the guided wizard:

```bash
ccswitch add
```

You'll be asked:

1. **Profile name** — a short identifier (e.g. `work`, `personal`, `bedrock-prod`)
2. **Auth type** — login, API key, Bedrock, or Bedrock API key
3. **Credentials** — depends on the type (API key, AWS profile name, etc.)
4. **Config isolation** — whether this profile gets its own settings/history/MCP config

## Quick alternative: snapshot current state

If Claude Code is already configured the way you want, snapshot it:

```bash
ccswitch save myprofile --type api-key
```

This reads the current live state (from settings, keychain, or environment) and stores it as a named profile.
