---
title: ccswitch env / ccuse
description: Per-shell profile switching
---

## Synopsis

```
ccswitch env <name>
ccswitch env --unset
ccuse <name>
ccuse --unset
```

## Description

Prints shell `export` statements that configure the current terminal to use a specific profile. Designed to be wrapped in `eval "$(…)"` — which is what the `ccuse` helper does.

Nothing global changes. Different terminals can use different profiles simultaneously.

## Options

| Option | Description |
|--------|-------------|
| `--unset` | Print `unset` statements to clear all managed env vars |

## What gets exported

| Profile type | Variables set |
|-------------|--------------|
| api-key | `ANTHROPIC_API_KEY` |
| login | `CLAUDE_CODE_OAUTH_TOKEN` |
| bedrock | `CLAUDE_CODE_USE_BEDROCK`, `AWS_PROFILE`, `AWS_REGION` |
| bedrock-key | `CLAUDE_CODE_USE_BEDROCK`, `AWS_BEARER_TOKEN_BEDROCK`, `AWS_REGION` |

If the profile has an isolated config dir, `CLAUDE_CONFIG_DIR` is also set.

## Examples

```bash
eval "$(ccswitch env work)"      # activate 'work' in this shell
eval "$(ccswitch env --unset)"   # clear overrides
ccuse work                       # same as the eval line above
ccuse --unset                    # same as the unset line above
```

## Related

- [Shell setup (ccuse)](/docs/getting-started/shell-setup) — how to set up `ccuse`
- [ccswitch](/docs/commands/ccswitch) — global switching
