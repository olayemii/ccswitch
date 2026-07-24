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
| `custom` | `ANTHROPIC_AUTH_TOKEN` value |

## The plaintext caveat (bedrock-key and custom)

For a global switch to a `bedrock-key` or `custom` profile, the bearer token is written to `settings.json` in plaintext. This is because Claude Code has no runtime helper for these (unlike `apiKeyHelper` for API keys). The token is a managed key — switching away removes it. Per-shell (`ccuse`) avoids this entirely by exporting the token only into that shell's environment.

## Managed keys and custom endpoints

Switching writes a set of *managed* env keys into `settings.json` and clears whatever the previous profile managed. `ANTHROPIC_BASE_URL` and the model-routing overrides are managed for exactly this reason: a base URL left behind by a custom endpoint would silently reroute the next profile — sending a subscription's OAuth credential to a third-party host.

The mechanism only covers keys that arrived through a switch. A base URL or token you hand-edited into `settings.json` was never managed, so nothing clears it; `ccswitch doctor` reports that case instead.
