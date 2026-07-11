---
title: ccswitch refresh
description: Replace a bedrock-key token in place
---

## Synopsis

```
ccswitch refresh <name> [--token <token>]
```

## Description

Replaces a `bedrock-key` profile's bearer token and re-derives its expiry, without recreating the profile. Reads the new token from `--token` or the `AWS_BEARER_TOKEN_BEDROCK` environment variable.

Use this when a short-lived Bedrock token has expired or is about to expire.

## Options

| Option | Description |
|--------|-------------|
| `--token <token>` | The new bearer token (otherwise reads `$AWS_BEARER_TOKEN_BEDROCK`) |

## Examples

```bash
# Re-export a fresh token, then refresh
export AWS_BEARER_TOKEN_BEDROCK=bedrock-api-key-...
ccswitch refresh bedrock-prod

# Or pass it directly
ccswitch refresh bedrock-prod --token bedrock-api-key-...
```

## Related

- [Expiry tracking](/docs/concepts/expiry-tracking) — how expiry is derived and tracked
- [Bedrock token expired](/docs/troubleshooting/bedrock-expired) — troubleshooting
