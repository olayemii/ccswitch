# Bedrock API key support (`bedrock-key`)

Date: 2026-07-10
Status: Approved for implementation

## Problem

Amazon Bedrock now supports API keys — a bearer token Claude Code reads from the
`AWS_BEARER_TOKEN_BEDROCK` environment variable (alongside `CLAUDE_CODE_USE_BEDROCK=1`).
None of ccswitch's three existing flows handles it:

- `api-key` sets `ANTHROPIC_API_KEY`, which targets the **direct Anthropic API**, not Bedrock.
- `bedrock` sets `CLAUDE_CODE_USE_BEDROCK=1` + `AWS_PROFILE`/`AWS_REGION` — the **AWS SigV4**
  credential path — and has no slot for a bearer token.

A Bedrock API key is a **secret** (unlike `AWS_PROFILE`/`AWS_REGION`, which are just names),
so it belongs in the secret store, consistent with how `login` and `api-key` credentials are held.

## Environment variables (confirmed against Claude Code docs)

```bash
export CLAUDE_CODE_USE_BEDROCK=1
export AWS_BEARER_TOKEN_BEDROCK=<bedrock-api-key>   # exact name; must include _BEDROCK
export AWS_REGION=<region>                          # optional; falls back to profile → us-east-1
```

`CLAUDE_CODE_USE_BEDROCK=1` is required. `AWS_REGION` is optional. There is no long-term vs
short-term distinction relevant to setting the variable.

## Design decisions

1. **New auth type `bedrock-key`** — a distinct fourth `AuthType`, not an optional flag on
   `bedrock`. Keeps SigV4-Bedrock secret-free and bearer-Bedrock always token-backed; no
   ambiguous half-configured profiles.

2. **Per-shell only; no global switch.** Claude Code only accepts the token via the
   `AWS_BEARER_TOKEN_BEDROCK` environment variable, and `apiKeyHelper` cannot supply it (it only
   feeds the Anthropic auth header). The global switch reaches the desktop app/IDE solely through
   `settings.json`, whose `env` values are literal plaintext — writing the token there would be a
   secret-exposure regression versus the keychain design. Therefore `bedrock-key` is supported
   **only** through the per-shell `ccswitch env <name>` / `ccuse <name>` flow, exactly like a
   `login` profile's captured OAuth token. Global switch refuses it with an actionable message.

## Storage model

- Bearer token → secret store, **default `secret` slot** (same as `api-key`).
- `profile.env = { CLAUDE_CODE_USE_BEDROCK: '1', AWS_REGION: <region> }` — non-secret;
  `AWS_REGION` omitted when blank. No `AWS_PROFILE`.

## Components and changes

### `src/types.ts`
- Add `'bedrock-key'` to the `AuthType` union and the `AUTH_TYPES` array.
- `isAuthType` requires no change (derives from `AUTH_TYPES`).

### `src/envexport.ts`
- Add `AWS_BEARER_TOKEN_BEDROCK` to `UNSET_KEYS`.
- New `case 'bedrock-key'` in `buildEnvExport`:
  - If `secret` is null/empty → throw `No stored Bedrock API key for profile '<name>'.`
  - Emit `export CLAUDE_CODE_USE_BEDROCK='1'`.
  - Emit `export AWS_REGION=...` only when `profile.env.AWS_REGION` is a non-empty string.
  - Emit `export AWS_BEARER_TOKEN_BEDROCK=<secret>`.
  - `CLAUDE_CONFIG_DIR` handled by the existing shared tail.

### `src/switch.ts`
- New `case 'bedrock-key'` in `globalSwitch`'s `switch (profile.type)`, throwing **before** any
  credential or disk mutation:
  `bedrock-key profiles can't be switched globally (the token would be stored in plaintext in
  settings.json). Use: ccswitch env <name>  (or: ccuse <name>)`.
- Because it throws before `applyCredential()` and the settings write, no disk state changes.

### `src/cli.ts`
- **`env` command** — no change needed: non-login types already read the `secret` slot
  (`slot: profile.type === 'login' ? 'token' : 'secret'`).
- **`add` command** — add a fourth select option `{ value: 'bedrock-key', label: 'Bedrock API key' }`.
  When chosen: `password` prompt for the token, `text` prompt for region;
  `setSecret(name, token, plat, p)` (default slot);
  `profile.env = { CLAUDE_CODE_USE_BEDROCK: '1', ...(region ? { AWS_REGION: region } : {}) }`.
- **`save <name> --type bedrock-key`** — read `env.AWS_BEARER_TOKEN_BEDROCK`; if unset/empty,
  throw `No AWS_BEARER_TOKEN_BEDROCK in environment to snapshot.`
  `setSecret(name, token, plat, p)`;
  `profile.env = { CLAUDE_CODE_USE_BEDROCK: '1', ...(env.AWS_REGION ? { AWS_REGION: env.AWS_REGION } : {}) }`.
  (`env` is already in `runCli` scope.)
- **`remove` command** — no change; it already deletes the default `secret` slot (and the `token`
  slot), covering `bedrock-key`.
- **New `help` command** — `ccswitch help` prints a concise overview:
  - the four auth types and what each sets;
  - which support **global** switch (`login`, `api-key`, `bedrock`) vs **per-shell only**
    (`bedrock-key`);
  - common commands: `add`, `save`, `token`, `env`/`ccuse`, `list`, `current`, `switch <name>`.
  Complements Commander's auto-generated `--help`.

### `README.md`
- Document `bedrock-key`: what it sets, that it is per-shell only (with the plaintext rationale),
  and the `add` / `save --type bedrock-key` capture paths.

## Data flow (per-shell)

```
ccuse prod
  → ccswitch env prod
    → loadProfile(prod)                       # type: bedrock-key
    → getSecret(prod, slot 'secret')          # bearer token
    → buildEnvExport(profile, secret)         # 3 exports (+ CLAUDE_CONFIG_DIR if isolated)
  → eval in shell                             # env vars set for this shell only
```

## Error handling

- `env`/`buildEnvExport` with no stored token → clear throw naming the profile.
- Global switch of `bedrock-key` → actionable throw pointing to `ccswitch env` / `ccuse`;
  no disk mutation.
- `save --type bedrock-key` with `AWS_BEARER_TOKEN_BEDROCK` unset → clear throw.

## Testing (TDD, one behavior per test)

- `types.test.ts` — `isAuthType('bedrock-key')` is true.
- `envexport.test.ts`
  - `bedrock-key` emits `CLAUDE_CODE_USE_BEDROCK`, `AWS_REGION`, `AWS_BEARER_TOKEN_BEDROCK` from the secret;
  - throws when the secret is null;
  - omits `AWS_REGION` when blank;
  - `buildEnvUnset` includes `AWS_BEARER_TOKEN_BEDROCK`.
- `switch.test.ts` — global switch of a `bedrock-key` profile throws an actionable message and
  calls neither `saveSettings` nor `writeActive` nor any credential mutation.
- `cli.test.ts`
  - `save --type bedrock-key` captures the token from `env` and errors when it is unset;
  - `help` prints the overview (mentions the four types and the per-shell-only note).

## Out of scope (YAGNI)

- Global-switch support for `bedrock-key`.
- Short-term vs long-term Bedrock key handling.
- Any Windows-specific token behavior beyond the existing per-platform secret patterns.
