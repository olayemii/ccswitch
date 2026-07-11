---
title: ccswitch add
description: Guided profile creation wizard
---

## Synopsis

```
ccswitch add
```

## Description

Interactive wizard to create a new profile. Walks you through:

1. Profile name
2. Auth type selection (login, API key, Bedrock, Bedrock API key)
3. Credential input (varies by type)
4. Optional config isolation

For login profiles, launches `claude auth login` and captures the credential. Optionally captures an OAuth token for per-shell use.

For bedrock-key profiles, automatically derives expiry from short-term tokens.

## Examples

```bash
ccswitch add
# → prompts for name, type, credentials, isolation
```

## Related

- [ccswitch save](/docs/commands/save) — snapshot current state instead of interactive setup
- [Auth Types](/docs/auth-types/login) — understand the different auth types
