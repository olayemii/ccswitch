---
title: Bedrock token expired
description: "Fix: Profile '<name>' Bedrock token expired"
---

## Problem

Switching to a `bedrock-key` profile gives:

```
Profile '<name>' Bedrock token expired 2h ago. Refresh it: ccswitch refresh <name>
```

## Cause

Short-term Bedrock API keys have an embedded expiry (typically 12 hours). Once expired, ccswitch blocks switching to prevent using a dead token.

## Fix

Get a fresh token from your Bedrock API key provider, then:

```bash
export AWS_BEARER_TOKEN_BEDROCK=<new-token>
ccswitch refresh <name>
```

Or pass it directly:

```bash
ccswitch refresh <name> --token <new-token>
```

The profile's expiry is re-derived from the new token automatically.
