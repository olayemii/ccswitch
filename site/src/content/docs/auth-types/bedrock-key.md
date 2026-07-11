---
title: Bedrock API key (bearer token)
description: Using an AWS Bedrock bearer token as a profile
---

A `bedrock-key` profile stores an AWS Bedrock bearer token (`AWS_BEARER_TOKEN_BEDROCK`). These tokens authenticate directly without SigV4 signing.

## When to use

- You have a Bedrock API key (bearer token)
- You don't want to set up the full AWS CLI credential chain

## Setup

```bash
ccswitch add
# choose "Bedrock API key", paste the token, optionally set region
```

Or snapshot from the environment:

```bash
export AWS_BEARER_TOKEN_BEDROCK=bedrock-api-key-...
ccswitch save bedrock-prod --type bedrock-key
```

## Expiry tracking

Short-term tokens (`bedrock-api-key-…`) embed an expiry that ccswitch parses automatically. Long-term tokens (`ABSK…`) are untracked.

- **Expired:** switching is blocked → `ccswitch refresh <name>`
- **Expiring (< 30min):** warning printed, switch proceeds

## Refresh

```bash
export AWS_BEARER_TOKEN_BEDROCK=<new-token>
ccswitch refresh bedrock-prod
```

## Plaintext caveat

On global switch, the token is written to `settings.json` in plaintext (Claude Code has no helper mechanism for it). Per-shell (`ccuse`) avoids this by exporting only into the shell.
