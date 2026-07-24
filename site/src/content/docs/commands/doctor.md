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
- **api-key / bedrock-key / custom:** masked credential preview
- **login:** account email/org, token capture date
- **bedrock-key:** expiry countdown
- **custom:** endpoint base URL

## Custom endpoint leakage check

Doctor also checks for custom-endpoint settings left behind while a *different* profile is active:

- `ANTHROPIC_AUTH_TOKEN` present with a non-custom active profile → **error**. It overrides that profile's credentials.
- `ANTHROPIC_BASE_URL` present with a non-custom active profile → **warn**. Its credentials would be sent to that endpoint. Harmless if you set it deliberately (a proxy); otherwise remove it and re-switch.

This catches the case where a base URL or token reached `settings.json` some way other than a switch — a hand-edit, or a `save --type custom` on a profile that was never activated — since switching only clears keys it previously managed.

## Findings

Doctor reports issues at two levels:
- **error** — something is broken (missing secrets, dangling pointers, settings mismatch)
- **warn** — something may cause problems soon (stale tokens, expiring credentials, missing config dirs)

Each finding includes a remediation command.

## Related

- [Expiry tracking](/docs/concepts/expiry-tracking) — how expiry tracking works
