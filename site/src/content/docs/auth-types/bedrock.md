---
title: Bedrock (SigV4)
description: Using AWS IAM credentials for Bedrock access
---

A `bedrock` profile uses AWS SigV4 credentials via a named AWS CLI profile. ccswitch doesn't hold the credentials — the AWS CLI manages them (SSO, IAM keys, etc.).

## When to use

- You access Claude through Amazon Bedrock
- You already have AWS CLI profiles configured
- Your credentials are managed via `aws sso login` or IAM

## Setup

```bash
ccswitch add
# choose "Bedrock", provide AWS_PROFILE and AWS_REGION
```

## Liveness check

Pass `--check` on global switch to verify credentials:

```bash
ccswitch my-bedrock --check
```

Runs `aws sts get-caller-identity`. If it fails, offers to run `aws sso login`.

## What gets stored

- `AWS_PROFILE` and `AWS_REGION` → profile JSON (env section)
- `CLAUDE_CODE_USE_BEDROCK=1` → written to settings on switch
- No secrets stored by ccswitch — AWS CLI handles credential storage
