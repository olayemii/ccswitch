---
title: Expiry tracking & liveness probes
description: How ccswitch handles token expiry and validates credentials
---

## Bedrock-key expiry

Short-term Bedrock API keys (`bedrock-api-key-…`) carry an embedded expiry (typically 12 hours). ccswitch parses this automatically when you `save`, `add`, or `refresh` a profile.

### Three states

| State | Meaning | Behavior |
|-------|---------|----------|
| `fresh` | Token has plenty of time | Silent |
| `expiring` | Within 30 minutes of expiry | Loud warning, non-blocking |
| `expired` | Past expiry | **Blocked** — cannot switch to this profile |

### Where it surfaces

- `ccswitch list` — shows countdown (e.g. `[expires in 3h]`)
- `ccswitch doctor` — reports as warn/error
- `ccswitch <name>` / `ccswitch env <name>` — blocks with remediation message

### Recovery

```bash
ccswitch refresh <name>
```

## Anthropic API key liveness

When switching to an `api-key` profile, ccswitch probes the Anthropic API (`GET /v1/models`) to verify the key is still valid:

- **200/403** — key is valid (403 = exists but lacks list permission)
- **401** — key is invalid or revoked → error printed
- **Network error** — warning printed, switch proceeds

Skip with `--no-check`.

## Bedrock SigV4 liveness

For `bedrock` profiles (AWS credentials), ccswitch runs `aws sts get-caller-identity` to check if the credentials work. If it fails, offers to run `aws sso login`.

Skip with `--no-check`.
