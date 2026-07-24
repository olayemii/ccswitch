---
title: Custom endpoint
description: Using an Anthropic-compatible endpoint as a profile
---

A `custom` profile points Claude Code at any Anthropic-compatible endpoint — DeepSeek, Moonshot, OpenRouter, a self-hosted vLLM, or a corporate proxy. It sets `ANTHROPIC_BASE_URL` plus a bearer token in `ANTHROPIC_AUTH_TOKEN`, and can pin which model names to request.

## When to use

- You want Claude Code to talk to a third-party Anthropic-compatible API
- You run models behind your own gateway (vLLM, LiteLLM, a corporate proxy)
- You need per-endpoint model name overrides

An `api-key` profile can't do this: it always authenticates against `api.anthropic.com`.

## Setup

```bash
ccswitch add
# choose "Custom Anthropic-compatible endpoint"
# → base URL, token, optional model overrides
```

Or snapshot from current settings:

```bash
ccswitch save deepseek --type custom
```

`save` reads `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` out of `settings.json`, moves the token into the OS secret store, and **removes the plaintext copy** from `settings.json`. Run `ccswitch deepseek` to activate the profile and put the token back in place.

## Model overrides

Endpoints rarely use Anthropic's model names, so a profile can pin its own. At the `add` prompt, pass them comma-separated:

```
ANTHROPIC_MODEL=deepseek-v4-pro,ANTHROPIC_DEFAULT_HAIKU_MODEL=deepseek-v4-flash
```

Only these keys are accepted — anything else is rejected, so a typo can't inject arbitrary settings:

| Key | Purpose |
|-----|---------|
| `ANTHROPIC_MODEL` | Default model |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | Model used where Claude Code asks for Opus |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | Model used where Claude Code asks for Sonnet |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | Model used where Claude Code asks for Haiku |
| `CLAUDE_CODE_SUBAGENT_MODEL` | Model used for subagents |

## No liveness check

Global switch skips the Anthropic API probe for `custom` profiles — endpoints vary too much for a shared health check. A bad token surfaces on first use rather than at switch time.

## What gets stored

- Token → OS secret store
- Profile JSON → base URL and model overrides (no secret)
- On global switch: `settings.json` gets `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` and any model overrides; `apiKeyHelper` is cleared and the live OAuth credential is neutralized

## Plaintext caveat

On global switch, the token is written to `settings.json` in plaintext — the same tradeoff as `bedrock-key`. All of these keys are *managed*, so switching to any other profile removes them. That matters more here than elsewhere: a leftover `ANTHROPIC_BASE_URL` would send your next profile's credentials to this endpoint. `ccswitch doctor` flags that situation if it ever arises.

Per-shell (`ccuse deepseek`) avoids the plaintext write entirely.

## Rotating the token

`ccswitch refresh` is `bedrock-key`-only. To replace a custom endpoint token, re-run `ccswitch add --force` with the same profile name.
