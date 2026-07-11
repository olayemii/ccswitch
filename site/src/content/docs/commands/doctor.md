---
title: ccswitch doctor
description: Diagnose profile health and configuration drift
---

## Synopsis

```
ccswitch doctor
```

## Description

Runs a full health check: verifies the active profile pointer, checks secret-store integrity, validates settings consistency, and reports token expiry/staleness.

Shows detailed info for the active profile:

```
Active profile details:
  name:        work
  type:        api-key
  config dir:  (default)
  credential:  sk-ant…a3f9 (len 108)
```

Fields vary by type:
- **api-key / bedrock-key:** masked credential preview
- **login:** account email/org, token capture date
- **bedrock-key:** expiry countdown

## Findings

Doctor reports issues at two levels:
- **error** — something is broken (missing secrets, dangling pointers, settings mismatch)
- **warn** — something may cause problems soon (stale tokens, expiring credentials, missing config dirs)

Each finding includes a remediation command.

## Related

- [Expiry tracking](/docs/concepts/expiry-tracking) — how expiry tracking works
