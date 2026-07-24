---
title: ccswitch list / current
description: View profiles and the active profile
---

## Synopsis

```
ccswitch list
ccswitch current
```

## Description

**`ccswitch list`** shows all profiles, marks the active one with `*`, and displays type and status info (stale tokens, bedrock-key expiry).

**`ccswitch current`** prints just the active profile name — useful in scripts or shell prompts.

## Examples

```bash
$ ccswitch list
* work (api-key)
  personal (login)  [stale token]
  bedrock-prod (bedrock-key)  [expires in 3h]
  deepseek (custom)

$ ccswitch current
work
```

## Related

- [ccswitch doctor](/docs/commands/doctor) — detailed diagnostics for the active profile
