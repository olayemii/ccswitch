# Short-lived Bedrock credential handling

Date: 2026-07-11
Status: Approved for implementation

## Problem

ccswitch stores a **static snapshot** of a Bedrock credential:

- `bedrock-key` — the `AWS_BEARER_TOKEN_BEDROCK` bearer token, held in the OS secret store.
- `bedrock` — SigV4 credentials behind a named `AWS_PROFILE` (ccswitch stores only the profile
  *name*, not the creds).

Short-term Bedrock API keys and STS/SSO SigV4 credentials **expire** (commonly ~12h and ~1h
respectively). When the snapshot goes stale, ccswitch happily activates it and auth fails
silently mid-session. There is no scriptable way to regenerate the credential — the user
obtains a fresh one by manual copy-paste.

## Goals

Because refresh is manual, ccswitch cannot auto-renew. The achievable goals are:

1. **Know** when a stored Bedrock token is expired / near expiry — automatically, with **no
   extra steps for the user** (no TTL prompts).
2. **Surface** it: in `doctor`/`list`, at switch time, and by **blocking** activation of a
   confidently-expired token.
3. **Make re-paste painless** via a `refresh` command that updates the token in place.

## Non-goals

- Auto-refreshing / minting tokens (no scriptable source exists).
- Prompting the user for a TTL or expiry. If expiry can't be derived automatically, the profile
  is simply **untracked** — it behaves exactly as today (no warnings, no blocking).

## Design decisions

### 1. Data model — one optional field

Add to `Profile` (`src/types.ts`):

```ts
credExpiresAt?: string   // absolute ISO 8601 timestamp. Absent => untracked / non-expiring.
```

Mirrors the existing `tokenCapturedAt` convention. No migration: absent means "behave as today".

### 2. Automatic expiry derivation — `src/bedrockExpiry.ts` (new, pure)

`deriveBedrockKeyExpiry(token: string): string | null`

- Short-term Bedrock API keys are a base64-encoded SigV4 presigned request embedding
  `X-Amz-Date` and `X-Amz-Expires`. Decode and compute the absolute expiry → return ISO string.
- Long-term / IAM-backed keys and any unrecognized format → return `null` (untracked, silent).
- Pure function, no I/O. This is the only place token bytes are parsed.

Called automatically wherever a `bedrock-key` token is captured — `add`, `save`, and the new
`refresh` — and the result written to `credExpiresAt`. **Zero user interaction.**

### 3. Expiry status — extend the `src/tokenAge.ts` pattern

`bedrockExpiryStatus(profile: Profile, now: Date): { state: BedrockExpiryState; expiresInMs: number | null }`

- `state ∈ 'fresh' | 'expiring' | 'expired' | 'untracked'`
- `untracked` when `credExpiresAt` is absent.
- `expiring` when `now` is within **30 minutes** of expiry (`BEDROCK_EXPIRING_MS`).
- `expired` when `now >= credExpiresAt`.

Pure; single source of truth for all four surfaces below. Unit-tested with a fixed `now`.

### 4. Four surfaces (all driven by §3)

| Surface | `fresh` | `expiring` | `expired` | `untracked` |
|---|---|---|---|---|
| `doctor` / `list` | `expires: in 3h` | `EXPIRING (12m)` | `EXPIRED (2h ago)` | *(nothing)* |
| switch time (`switch.ts`) | — | loud warning | — | — |
| block activation (`switch.ts` + `ccswitch env`) | — | — | **refuse** | — |
| `ccswitch refresh <name>` | remedy | remedy | remedy | remedy |

- **Blocking** applies to `bedrock-key` only and **only when confidently `expired`**. Message:
  `Profile 'x' Bedrock token expired 2h ago. Refresh: ccswitch refresh x`. `untracked` never
  blocks, so long-term keys and unparseable tokens are unaffected.
- **`ccswitch refresh <name>`** (new command): reads a fresh `AWS_BEARER_TOKEN_BEDROCK` from the
  environment (like `save`) or `--token`, updates the keychain secret **in place**, and
  re-derives `credExpiresAt`. Does **not** recreate the profile — `configDir`, isolation, and
  all other fields are preserved.

### 5. `bedrock` SigV4 type — advisory only, opt-in

ccswitch does not hold SigV4 creds (they live behind `AWS_PROFILE`, refreshed by the AWS SDK),
so there is no stored expiry to track or block on.

- **Opt-in liveness probe, OFF by default.** With `--check`, switching to a `bedrock` profile
  runs `aws sts get-caller-identity --profile <p>`; on failure, **warn** (never hard-block —
  `AWS_PROFILE` may refresh transparently on next use). Off by default to avoid adding latency
  and an `aws` dependency to every Bedrock switch.

### 6. Testing

- `src/bedrockExpiry.ts` — pure. Fixtures: a valid short-term key (expiry parses), a long-term
  key (→ `null`), and garbage (→ `null`).
- `bedrockExpiryStatus` — table test across the four states with a fixed `now`.
- Switch/env blocking — fabricated profiles with `credExpiresAt` in the past/future assert
  refuse vs. allow, matching the existing test style.

## Decided defaults (previously open)

- SigV4 liveness probe: **opt-in via `--check`, off by default.**
- "expiring" threshold: **30 minutes.**
