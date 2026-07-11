---
title: Credential storage
description: How ccswitch stores and retrieves secrets
---

## Where secrets live

All sensitive credentials are stored in the OS secret store:
- **macOS:** login keychain
- **Windows:** Windows Credential Manager
- **Linux:** libsecret (GNOME Keyring / KDE Wallet)

Secrets are keyed by profile name. They never live in plaintext profile JSON files.

## What's stored per type

| Profile type | Secret stored |
|-------------|--------------|
| `login` | Credential blob from `.credentials.json` |
| `login` (token slot) | Long-lived OAuth token |
| `api-key` | `ANTHROPIC_API_KEY` value |
| `bedrock-key` | `AWS_BEARER_TOKEN_BEDROCK` value |
| `bedrock` | Nothing — uses AWS CLI's own credential chain |

## The bedrock-key plaintext caveat

For a global switch to a `bedrock-key` profile, the bearer token is written to `settings.json` in plaintext. This is because Claude Code has no runtime helper for Bedrock bearer tokens (unlike `apiKeyHelper` for API keys). The token is a managed key — switching away removes it. Per-shell (`ccuse`) avoids this entirely by exporting the token only into that shell's environment.
