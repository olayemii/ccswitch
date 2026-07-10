# Design: correct OAuth account switching

Date: 2026-07-10

## Problem

Switching between login (OAuth) profiles did not change the account Claude Code
uses or displays. Investigation found three defects:

1. **Wrong keychain account (FIXED).** `credentials.ts` wrote/deleted the live
   credential under keychain account `default`, and read with no account at all.
   Claude Code stores its credential under account `$USER`. ccswitch therefore
   operated on a keychain item Claude never reads, so switches had no effect.
   Fixed by resolving the account from the existing live item (falling back to
   `$USER`) and using it consistently for read/write/neutralize.

2. **Re-snapshot cross-contamination (consequence of #1).** On switch-away,
   `switch.ts` re-snapshots the *live* credential into the outgoing profile. With
   bug #1, the live item was always the same stale session, so repeated switches
   overwrote other profiles' stored credentials. Fixed transitively by #1; no
   further code change, but existing corrupted stores must be re-captured.

3. **Cached account identity (THIS DESIGN).** `claude auth status` and the app's
   displayed account read `oauthAccount` from `~/.claude.json`, not the keychain
   blob. Swapping the keychain credential does not refresh it. A full account
   switch must also swap `oauthAccount`.

## Scope

Add per-profile capture and switch-time application of the `oauthAccount` object
so that switching a login profile updates both the keychain credential and the
cached identity in `~/.claude.json`.

Out of scope: config-isolated profiles (they carry their own `.claude.json`);
changing the dup-detection fingerprint (noted as a follow-up below).

## Design

### Path resolution
Add `claudeJsonFile` to `Paths`:
- `CLAUDE_CONFIG_DIR` set → `$CLAUDE_CONFIG_DIR/.claude.json`
- else → `$HOME/.claude.json`

(Distinct from `claudeConfigDir`, which is `$HOME/.claude` when the env var is
unset — `.claude.json` is a sibling of that dir, not inside it.)

### New module `oauthAccount.ts`
- `readOAuthAccount(paths): unknown | null` — parse `claudeJsonFile`, return the
  `oauthAccount` value or `null` if the file/key is absent or unparseable.
- `writeOAuthAccount(paths, account: unknown): void` — read the full JSON, set
  `oauthAccount`, write back **atomically** (write temp file in same dir, then
  rename) preserving all other keys and using 2-space indentation to match
  Claude Code's formatting. If the file does not exist, do nothing (a login
  profile without a live app has no config to patch).
- `clearOAuthAccount(paths): void` — same atomic patch, deleting the key.
  Used when switching to non-login profiles is out of scope, so this is only a
  helper for completeness; not wired unless needed.

### Profile shape
Add optional `oauthAccount?: unknown` to `Profile`. It is non-secret metadata
(email, org, uuids) and lives in the plaintext profile JSON, next to `credHash`.

### Capture (write the snapshot)
Everywhere a login credential is captured, also snapshot `oauthAccount`:
- `save <name> --type login` (cli.ts)
- `captureLogin` afterCapture / the `add` flow (cli.ts + loginCapture.ts)

Read `oauthAccount` immediately after the credential, store it on the profile.

### Switch (apply the snapshot)
In `globalSwitch`, for `type === 'login'`:
- After `writeLiveCredential`, if the profile has a stored `oauthAccount`, call
  `writeOAuthAccount` to restore it into `~/.claude.json`.
- Re-snapshot parity: when switching away from a login profile, in addition to
  re-snapshotting the credential, re-read the current `oauthAccount` and persist
  it onto the outgoing profile, so rotation/updates (e.g. `profileFetchedAt`,
  seat changes) are retained. Best-effort, mirrors the credential re-snapshot.

`oauthAccount` is applied via the same `applyCredential`-style ordering: the
fragile keychain write happens first; the `~/.claude.json` patch is best-effort
and must never leave the file corrupt (atomic rename guarantees this).

### Error handling
- `writeOAuthAccount` never partially writes: temp-file + atomic rename.
- A malformed `~/.claude.json` (unparseable) aborts the patch with a clear
  warning rather than overwriting the user's config.

## Recovery for the current machine
Both existing login profiles now hold the same (scholastic) credential; the
personal credential was lost to bug #2. After this lands, re-login each profile
(`ccswitch add` / re-login flow) so each stores its correct credential **and**
its `oauthAccount`. The orphan `acct=default` keychain item has been deleted.

## Follow-up (not in this change)
`oauthAccount.accountUuid` / `emailAddress` is a **stable** account identifier.
Dup-detection currently hashes the rotating credential blob, which changes every
login even for the same account. A later change could key dup-detection on the
account uuid instead, fixing the "same account, different hash" gap.

## Testing
- `oauthAccount.ts`: read returns null when file/key absent; write preserves
  sibling keys and is atomic; write is a no-op when file absent.
- Path: `claudeJsonFile` resolves to `$HOME/.claude.json` (no env) and
  `$CLAUDE_CONFIG_DIR/.claude.json` (env set).
- `globalSwitch`: applies stored `oauthAccount` on switch-to; re-snapshots on
  switch-away; login profile without stored `oauthAccount` skips the patch.
- Capture paths store `oauthAccount` on the profile.
