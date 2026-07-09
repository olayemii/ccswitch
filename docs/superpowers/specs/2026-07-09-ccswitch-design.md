# ccswitch — Claude account switcher

**Date:** 2026-07-09
**Status:** Approved design, ready for implementation planning

## Purpose

A standalone CLI, `ccswitch`, that lets a user switch the active Claude Code
account between any number of profiles — subscription logins (work, personal),
API keys, and Bedrock — with one command. One account is active at a time,
globally, so the terminal CLI, the desktop app, and IDE extensions all use it.

## Goals

- Switch between arbitrary profiles of **any** auth type: subscription OAuth
  login, `ANTHROPIC_API_KEY`, or Bedrock (`CLAUDE_CODE_USE_BEDROCK` + AWS).
- One clear global "active account" model — simple to reason about.
- Never store secrets in plaintext files.
- Never clobber the parts of `settings.json` the user manages themselves.

## Non-goals (YAGNI)

- Running two different accounts simultaneously in separate terminals. OAuth
  logins can't be switched per-shell anyway. An env-launch mode can be added
  later if API-key parallelism is ever needed.
- Cross-platform support beyond macOS. This targets the macOS keychain
  (`security`) initially.

## Auth mechanics this relies on

- **Subscription login:** OAuth credential stored in the macOS keychain under
  service `Claude Code-credentials`. Can only be switched by swapping this
  keychain entry — env vars cannot override it.
- **API key:** `ANTHROPIC_API_KEY`, or an `apiKeyHelper` script in
  `settings.json` that prints the key on demand.
- **Bedrock:** `CLAUDE_CODE_USE_BEDROCK=1` plus `AWS_PROFILE` / `AWS_REGION`.
  Actual AWS credentials live in `~/.aws`, managed by the AWS CLI — outside
  this tool's scope.
- `~/.claude/settings.json` supports an `env` object and `apiKeyHelper`, which
  is how API-key and Bedrock config is applied globally.

## Security model

Secrets never sit in plaintext files. Each profile's secret lives in the macOS
keychain under a namespaced service `ccswitch:<name>`:

- **Login profile** → the OAuth credential JSON is copied to `ccswitch:<name>`.
- **API-key profile** → the key is stored at `ccswitch:<name>`. At switch time
  Claude reads it via an `apiKeyHelper` script that runs
  `security find-generic-password` — the key is never written into
  `settings.json` as raw text.
- **Bedrock profile** → no secret held by this tool. Only non-secret env vars.

Non-secret profile metadata (name, type, env fragment) lives in
`~/.ccswitch/profiles/<name>.json`. The active pointer lives in
`~/.ccswitch/active`.

## What a switch does

`settings.json` belongs to the user (permissions, hooks, statusline, etc.). The
tool touches only a **managed set of keys** and preserves everything else:

1. Back up `~/.claude/settings.json` to a timestamped file first.
2. Set or clear the managed `env` keys (`ANTHROPIC_API_KEY` via helper,
   `CLAUDE_CODE_USE_BEDROCK`, `AWS_PROFILE`, `AWS_REGION`) and `apiKeyHelper`
   for the target profile. A stored `managedKeys` list ensures the tool never
   removes or overwrites env vars the user set themselves.
3. For a **login** profile: restore its OAuth credential into the live
   `Claude Code-credentials` keychain entry. For **api-key / bedrock**:
   neutralize the live OAuth entry so it cannot take precedence.
4. Write `~/.ccswitch/active` = the profile name.

**Documented caveat:** the desktop app and IDE extensions cache the token in
memory, so after a switch the user must restart those. A freshly launched
`claude` in the terminal picks up the new account immediately.

## Commands

```
ccswitch                 interactive picker → switch
ccswitch <name>          switch directly
ccswitch save <name>     snapshot current live state into a profile
ccswitch add             guided setup (choose login / api-key / bedrock)
ccswitch list            show profiles, mark the active one
ccswitch current         print active profile
ccswitch remove <name>   delete a profile (+ its keychain secret)
```

### Capture: both methods

- `save <name>` snapshots whatever is currently live — reads the
  `Claude Code-credentials` keychain entry and the managed env from
  `settings.json` — and stores it as the named profile. Workflow: log in
  normally, then snapshot.
- `add` runs a guided setup that asks the auth type and collects the right
  fields (OAuth is captured from the live state; API key is entered and stored
  to keychain; Bedrock collects `AWS_PROFILE` / `AWS_REGION`).

## Code shape (isolated, testable units)

- `keychain.ts` — read/write/delete keychain entries (thin wrapper over
  `security`).
- `settings.ts` — load / patch / save `settings.json`; managed-keys logic;
  timestamped backups. Pure, fixture-tested.
- `profiles.ts` — CRUD on the profile store and the active pointer.
- `switch.ts` — orchestrates a switch from a profile record.
- `cli.ts` — argument parsing, the interactive picker, and wiring.

Pure logic (settings patching, managed-keys resolution) is unit-tested against
fixtures. Keychain and AWS calls sit behind thin wrappers that are mocked in
tests.

## Language & packaging

- Node / TypeScript.
- Distributed as a CLI with a `ccswitch` bin entry, installable/linkable onto
  the user's PATH.

## Error handling

- Refuse to switch to an unknown profile; suggest `ccswitch list`.
- Refuse `save`/`add` for a name that exists without a `--force` confirmation.
- If the live keychain read fails during `save`, report clearly (user may not
  be logged in).
- Every write to `settings.json` is preceded by a backup; a failed patch leaves
  the original intact.
