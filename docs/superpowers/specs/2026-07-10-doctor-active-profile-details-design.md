# ccswitch doctor — active-profile identity details

## Goal

`ccswitch doctor` currently reports only drift findings (ok/warn/error). It never
shows *who* or *what* the active profile actually is. This change appends an
"Active profile details" block that surfaces the active profile's identity and a
masked credential preview, so a user can confirm at a glance which account /
credential they are running as.

Scope is the **active profile only** (not the live login, not per-profile).

## Output

Printed after the drift findings and before the `N error(s), M warning(s)` summary:

```
Active profile details:
  name:        work
  type:        bedrock-key
  config dir:  (default)
  credential:  sk-ant…a3f9 (len 108)
  account:     olayemii@example.com — Acme Inc
  token:       captured 12 days ago (2026-06-28)
```

Lines render only when applicable to the active profile's type:

- **login** → `account:` (email — org) from stored `profile.oauthAccount`, and
  `token:` (age + capture date). No `credential:` line — the stored login secret
  is a JSON credential blob, not a maskable key string.
- **api-key / bedrock-key** → `credential:` masked preview of the stored secret.
  No `account:`/`token:` lines.
- **bedrock** → env-only; name/type/config dir only (no secret, no account).
- **No active profile** → the block is replaced by a single line `No active profile.`

Field detail rules:

- `config dir:` shows the path, or `(default)` when `profile.configDir` is unset.
- `account:` shows `email — org` when both present; `email` alone when org missing;
  omitted entirely when `oauthAccount` is absent or has no email.
- `token:` for a login profile: `captured N days ago (YYYY-MM-DD)` when a capture
  timestamp exists; `present, capture date unknown` when `hasToken` but no
  `tokenCapturedAt`; `none captured` when no token.
- `credential:` shows the masked preview, or `(missing)` when the active
  api-key/bedrock-key profile has no stored secret.

## Architecture

Keep `diagnose()` pure and unit-testable; mirror that for the new code.

### `src/doctor.ts`

- **`maskSecret(value: string | null): string`** — pure helper.
  - `null`/empty → `(none)`
  - length ≥ 12 → `${first 6}…${last 4} (len N)`
  - length < 12 → `…${last 4} (len N)` (guard against over-exposing short secrets)
- **`describeActive(snap: DoctorSnapshot): string[]`** — pure. Returns the display
  lines (without icons). Reads everything from the snapshot:
  - active profile via `snap.active` + lookup in `snap.profiles`
  - masked credential via `maskSecret(profileStates[name].secretPreview)`
  - account via `profile.oauthAccount` (cast to read `emailAddress` /
    `organizationName`)
  - token age via existing `tokenAgeDays(profile, snap.now)` and
    `profile.tokenCapturedAt`
- Extend **`ProfileState`** with `secretPreview?: string` — the raw stored secret
  value for the active api-key/bedrock-key profile (the CLI already reads secret
  presence; capture the value for the active profile). Other profiles leave it
  unset.

### `src/cli.ts` (`doctor` action)

- When reading `profileStates`, for the **active** api-key/bedrock-key profile,
  capture the returned secret value into `secretPreview` (getSecret already
  returns the value or null). Non-active or non-key profiles: leave unset — avoid
  loading every secret into memory unnecessarily.
- After printing findings, print `describeActive(snap)` lines, then the summary.

## Account object shape

`oauthAccount` is typed `unknown` (Claude Code's cached identity). Read defensively:
`emailAddress` and `organizationName` string fields (confirmed via existing tests);
missing/malformed → omit the `account:` line.

## Testing (`test/doctor.test.ts`)

- `maskSecret`: long value, short value (< 12), empty, null.
- `describeActive`:
  - api-key active → masked credential line, no account/token.
  - bedrock-key active with `secretPreview` set → masked line; with missing secret → `(missing)`.
  - login active with oauthAccount (email+org) and token timestamp → account + token lines.
  - login with email only (no org) → email alone.
  - login with `hasToken` but no `tokenCapturedAt` → `present, capture date unknown`.
  - login with no oauthAccount → account line omitted.
  - bedrock active → name/type/config dir only.
  - `configDir` set → path shown; unset → `(default)`.
  - no active profile → `['No active profile.']`.

## Non-goals

- No live `claude auth status` call in `describeActive` (keep it pure/offline).
- No full secret ever printed; no per-profile listing; no live-login block.
