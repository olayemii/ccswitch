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
so it is held in the secret store, consistent with `login` and `api-key` credentials.

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

2. **Global switch is supported, via `settings.json` (Design A).** `bedrock-key` is symmetric
   with `api-key`: it works both globally (`ccswitch <name>`) and per-shell
   (`ccswitch env <name>` / `ccuse`).

   **Why the token goes into `settings.json` in plaintext.** Verified against the Claude Code docs:
   there is **no runtime credential-helper mechanism** that can source a Bedrock bearer token from a
   command/keychain at launch —
   - `awsCredentialExport` supplies only SigV4 credentials (access/secret/session), not bearer tokens;
   - `awsAuthRefresh` only refreshes `~/.aws`, it does not set `AWS_BEARER_TOKEN_BEDROCK`;
   - `apiKeyHelper` is skipped entirely when `CLAUDE_CODE_USE_BEDROCK=1` (cloud-provider auth wins the
     precedence order).

   So the only way the desktop app / IDE / CLI can pick up the token via ccswitch's global switch is
   the `settings.json` `env` block, whose values are literal plaintext. The repo owner has accepted
   this tradeoff for a single-user machine.

   **A shell-hook alternative was considered and rejected.** A `~/.zshrc` hook that exports the token
   from the keychain per shell would avoid plaintext, but only reaches terminal-launched `claude` —
   the desktop app and IDE extension do not source `~/.zshrc`. Since GUI coverage requires the
   plaintext `settings.json` write anyway, and the CLI already reads that same file, the hook would
   add moving parts (an rc edit, a per-shell keychain read) for zero additional hygiene or coverage.
   Dropped as redundant.

   **Hygiene bonus.** `AWS_BEARER_TOKEN_BEDROCK` is registered as a managed env key, so
   `patchSettings` removes it from `settings.json` when switching to any other profile — the plaintext
   token only exists on disk while a `bedrock-key` profile is the active global profile.

## Storage model

- Bearer token → secret store, **default `secret` slot** (same as `api-key`).
- `profile.env = { CLAUDE_CODE_USE_BEDROCK: '1', AWS_REGION: <region> }` — non-secret;
  `AWS_REGION` omitted when blank. No `AWS_PROFILE`.
- The token is never stored in the profile JSON; it is read from the secret store at switch time.

## Components and changes

### `src/types.ts`
- Add `'bedrock-key'` to the `AuthType` union and the `AUTH_TYPES` array.
- `isAuthType` requires no change (derives from `AUTH_TYPES`).

### `src/settings.ts`
- Add `'AWS_BEARER_TOKEN_BEDROCK'` to `MANAGED_ENV_KEYS`, so `patchSettings` both writes it on
  switch-in and clears it on switch-away.

### `src/switch.ts`
- New `case 'bedrock-key'` in `globalSwitch`'s `switch (profile.type)`:
  - `secret = await deps.getSecret(profile.name, deps.plat, deps.paths)`; if null →
    `throw new Error("No stored Bedrock API key for profile '<name>'.")`.
  - `desired = { env: { ...profile.env, AWS_BEARER_TOKEN_BEDROCK: secret }, apiKeyHelper: null }`.
  - `applyCredential = () => deps.neutralizeLiveCredential(...)` (same as `bedrock`/`api-key`).
- The existing outgoing-login re-snapshot step (added earlier) is unaffected.

### `src/envexport.ts`
- Add `AWS_BEARER_TOKEN_BEDROCK` to `UNSET_KEYS`.
- New `case 'bedrock-key'` in `buildEnvExport`:
  - If `secret` is null/empty → throw `No stored Bedrock API key for profile '<name>'.`
  - Emit `export CLAUDE_CODE_USE_BEDROCK='1'`.
  - Emit `export AWS_REGION=...` only when `profile.env.AWS_REGION` is a non-empty string.
  - Emit `export AWS_BEARER_TOKEN_BEDROCK=<secret>`.
  - `CLAUDE_CONFIG_DIR` handled by the existing shared tail.

### `src/cli.ts`
- **`env` command** — no change: non-login types already read the `secret` slot
  (`slot: profile.type === 'login' ? 'token' : 'secret'`).
- **`add` command** — fourth select option `{ value: 'bedrock-key', label: 'Bedrock API key' }`.
  When chosen: `password` prompt for the token, `text` prompt for region;
  `setSecret(name, token, plat, p)` (default slot);
  `profile.env = { CLAUDE_CODE_USE_BEDROCK: '1', ...(region ? { AWS_REGION: region } : {}) }`.
- **`save <name> --type bedrock-key`** — read `env.AWS_BEARER_TOKEN_BEDROCK`; if unset/empty,
  throw `No AWS_BEARER_TOKEN_BEDROCK in environment to snapshot.`
  `setSecret(name, token, plat, p)`;
  `profile.env = { CLAUDE_CODE_USE_BEDROCK: '1', ...(env.AWS_REGION ? { AWS_REGION: env.AWS_REGION } : {}) }`.
  (`env` is already in `runCli` scope.)
- **default switch action** — already routes every profile through `globalSwitch`; the new
  `bedrock-key` case there is reached automatically. No change beyond `globalSwitch`.
- **`remove` command** — no change; it already deletes the default `secret` slot (and the `token`
  slot), covering `bedrock-key`.
- **New `help` command** — `ccswitch help` prints a concise overview:
  - the four auth types and what each sets;
  - that all four support both global switch and per-shell `env`;
  - the plaintext-on-disk note for `bedrock-key` global switch;
  - common commands: `add`, `save`, `token`, `env`/`ccuse`, `list`, `current`, `switch <name>`.
  Complements Commander's auto-generated `--help`.

### `README.md`
- Document `bedrock-key`: what it sets, that global switch writes the token to `settings.json`
  in plaintext (cleared on switch-away), and the `add` / `save --type bedrock-key` capture paths.

## Data flow

### Global switch
```
ccswitch bedrock-prod
  → globalSwitch(profile)                       # type: bedrock-key
    → getSecret(bedrock-prod, slot 'secret')    # bearer token
    → neutralizeLiveCredential()                # remove any login keychain entry
    → patchSettings: settings.env gets
        CLAUDE_CODE_USE_BEDROCK, AWS_REGION?, AWS_BEARER_TOKEN_BEDROCK (managed)
    → writeActive({ name, managedKeys })
  # desktop app / IDE / CLI read settings.json
ccswitch <other>
  → patchSettings clears the managed AWS_BEARER_TOKEN_BEDROCK from settings.json
```

### Per-shell
```
ccuse bedrock-prod → ccswitch env bedrock-prod
  → loadProfile → getSecret(slot 'secret')
  → buildEnvExport → 3 exports (+ CLAUDE_CONFIG_DIR if isolated)
  → eval in shell
```

## Error handling

- `buildEnvExport` / global switch with no stored token → clear throw naming the profile.
- `save --type bedrock-key` with `AWS_BEARER_TOKEN_BEDROCK` unset → clear throw.
- Global switch remains transactional: the credential step (`neutralizeLiveCredential`) runs before
  the settings write, and a settings/active failure yields the existing actionable backup message.

## Testing (TDD, one behavior per test)

- `types.test.ts` — `isAuthType('bedrock-key')` is true.
- `settings.test.ts` — `patchSettings` writes `env.AWS_BEARER_TOKEN_BEDROCK` when desired and clears
  it when previously managed and no longer desired.
- `envexport.test.ts`
  - `bedrock-key` emits `CLAUDE_CODE_USE_BEDROCK`, `AWS_REGION`, `AWS_BEARER_TOKEN_BEDROCK` from the secret;
  - throws when the secret is null;
  - omits `AWS_REGION` when blank;
  - `buildEnvUnset` includes `AWS_BEARER_TOKEN_BEDROCK`.
- `switch.test.ts` — global switch of a `bedrock-key` profile writes `AWS_BEARER_TOKEN_BEDROCK`
  (+ bedrock env) into settings, marks it managed, and neutralizes the live login credential;
  throws when the token is missing.
- `cli.test.ts`
  - `save --type bedrock-key` captures the token from `env` and errors when it is unset;
  - `help` prints the overview (mentions the four types and the plaintext note).

## Out of scope (YAGNI)

- A shell-hook / `shellenv` auto-injection mechanism (rejected as redundant given Design A).
- Short-term vs long-term Bedrock key handling.
- Any Windows-specific token behavior beyond the existing per-platform secret patterns.
