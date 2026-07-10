# Distinct login-account capture

**Date:** 2026-07-10
**Status:** Approved (pending spec review)

## Problem

Adding two `login` (OAuth) profiles (e.g. `personal` and `work`) results in both
profiles holding the **same** credential. The user cannot maintain multiple
distinct Anthropic accounts for global switching.

### Root cause

OAuth login is globally single-account: there is exactly one live credential
(`Claude Code-credentials` in the keychain, or `.credentials.json` on other
platforms). The `add` and `save` commands for `login` profiles **passively copy
whatever is currently live** into `ccswitch:<name>`. If the user does not log in
as a different account between two adds, both snapshots are byte-identical and
point at the same account.

The storage layer is already fully name-scoped (`ccswitch:<name>` per profile),
so nothing there needs to change. The defect is entirely in the **capture step**.

### Scope of what already works (unchanged)

| Mode          | Multiple accounts today | Mechanism                                            |
|---------------|-------------------------|------------------------------------------------------|
| `api-key`     | Works                   | `add` prompts you to type the key → distinct per name |
| `bedrock`     | Works                   | `add` prompts for `AWS_PROFILE` / `AWS_REGION`        |
| `bedrock-key` | Works                   | `add` prompts for the bearer token                   |
| `login` (per-shell) | Works             | `ccswitch token <name>` runs `claude setup-token`, which authenticates fresh in the browser |
| `login` (global) | **Broken**           | `add`/`save` passively copy the current live credential |

The only real defect is `login` capture for global switching.

## Design

### 1. Guided re-login on capture (`login` type)

`add` and `save` for a `login` profile must guide the user to authenticate as the
intended account before snapshotting, rather than silently copying the current
live credential.

Because `/login` is an interactive slash command inside the Claude Code TUI,
driving it from a subprocess is fragile. Instead, use a **pause-and-prompt**
flow:

1. Prompt: *"Log in as the account for `<name>` in Claude Code (run `/login`),
   then press Enter to capture."*
2. On confirm, read the now-live credential (`readLiveCredential`).
3. Error clearly if no live credential is found (user skipped login).
4. Store into `ccswitch:<name>` (existing `setSecret`).

This makes each profile capture its own account, because the user authenticates
fresh for each one.

### 2. Duplicate-credential guard (`login` type)

The bug's signature is a byte-identical captured blob (a passive copy with no
re-login in between). OAuth blobs rotate on refresh, so identical bytes reliably
mean "same credential, not re-captured" — exactly the failure mode. We do not
need to parse account identity out of the blob.

- Persist a `credHash` field on the login profile: SHA-256 (hex) of the captured
  credential string. Never store the raw credential in the profile file.
- On capture, compute the hash and compare against the `credHash` of all other
  `login` profiles.
- On an exact match, warn: *"This credential is identical to profile
  `<other>` — you probably didn't log in as a different account. Continue
  anyway?"* with an override (`--force`, or a confirm prompt in the guided flow).

This also guards the repeated-`save` footgun (any `login` `save` that snapshots
the same live state twice).

### 3. Unchanged

Storage layer, per-shell tokens (`token` slot), and the `api-key` / `bedrock` /
`bedrock-key` flows are untouched — they already support multiple accounts.

## Data model change

`Profile` (login only) gains an optional field:

```ts
credHash?: string   // SHA-256 hex of the captured credential; used only for the duplicate guard
```

Existing profiles without `credHash` are treated as "unknown" and never trigger a
false match.

## Affected files

- `src/cli.ts` — `add` and `save` actions: guided re-login prompt for `login`;
  compute + store `credHash`; duplicate-guard warning/override.
- `src/types.ts` — add optional `credHash` to `Profile`.
- `src/profiles.ts` — no change expected (Profile is persisted as-is).
- new helper (in `src/helpers.ts` or a small `src/fingerprint.ts`) — `hashCredential(value): string`.
- `test/cli.test.ts` / relevant test files — cover guided capture, hash storage,
  duplicate detection + override.

## Error handling

- No live credential after the login prompt → clear error instructing the user to
  run `/login` first.
- Duplicate credential detected → warn with override; non-interactive `save`
  requires `--force` to proceed.

## Testing

- Adding a `login` profile captures the current live credential and records its
  `credHash`.
- Adding a second `login` profile with an identical live credential triggers the
  duplicate warning; with override it still stores.
- Adding a second `login` profile with a different live credential stores without
  warning and records a distinct `credHash`.
- api-key / bedrock / bedrock-key flows are unaffected (regression check).
