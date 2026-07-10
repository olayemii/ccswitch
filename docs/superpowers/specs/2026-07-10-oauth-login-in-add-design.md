# Trigger `claude auth login` during `add` (OAuth capture)

Date: 2026-07-10
Status: Approved for implementation

## Problem

Adding a `login`-type profile today is a two-step manual dance (`cli.ts:220-227`):
the user is told to go run `/login` in Claude Code as the target account, then come
back and confirm, at which point `add` reads whatever credential Claude Code left in
the live slot (`readLiveCredential`, `credentials.ts:10`).

The `claude` CLI actually exposes a scriptable `claude auth login` subcommand (with a
sibling `claude auth status --json`). So `add` can drive the OAuth login itself instead
of instructing the user to do it out-of-band. This removes the manual confirm step and
the "No live login found. Run /login first" failure mode.

## Confirmed CLI surface

```
$ claude auth login            # runs the OAuth/browser sign-in flow (interactive)
$ claude auth status --json    # -> { "loggedIn": true, "authMethod": "claude.ai",
                               #      "email": "...", ... }
```

`claude auth login` writes to the **same** machine-global live credential slot that
`readLiveCredential()` reads (keychain service `Claude Code-credentials`, or
`~/.claude/.credentials.json`). No new capture mechanism is needed — after login
completes, the existing read path picks it up.

## Design decisions

1. **Always launch.** The `login` branch of `add` always runs `claude auth login`
   inline. The old "log in yourself, then confirm to capture" prompt is removed. No
   opt-out flag.

2. **Bare invocation.** `claude auth login` is run with **no flags** — no `--email`,
   no `--claudeai`/`--console`. Claude Code's own login screen handles account type
   and email entry.

3. **Restore the previously-active login.** Because `claude auth login` clobbers the
   machine's current live credential, `add` snapshots the live credential *before*
   login and writes it back *after* capture. Adding a profile is therefore
   non-disruptive to the current session. If there was no previous live credential,
   the live slot is neutralized (`neutralizeLiveCredential`).

4. **Confirm via `claude auth status --json`.** Success is confirmed by parsing the
   status JSON and checking `loggedIn === true` (not merely by a zero exit code).

5. **Interactive spawn lives in `exec.ts`.** A new `runInteractive()` sibling to
   `run()` spawns with `stdio: 'inherit'` and resolves with the exit code, keeping all
   process spawning in one injectable, testable place (matches the existing `run` DI
   pattern used across `credentials.ts`, `helpers.ts`, `switch.ts`).

## Flow (login branch of `add`)

```
1. prev = readLiveCredential()               // snapshot; may be null on a fresh machine
   try:
2.   code = runInteractive('claude', ['auth', 'login'])   // user completes browser OAuth
       code != 0            -> throw "claude auth login did not complete"
3.   status = claude auth status --json
       !status.loggedIn     -> throw "login did not complete — no profile added"
4.   cred = readLiveCredential()
       cred == null         -> throw "could not read the new login credential"
5.   credHash = hashCredential(cred)
     dup = findDuplicateLoginName(credHash, listProfiles(), name)   // unchanged behavior
       dup && !confirmed    -> abort (return)
6.   setSecret(name, cred); profile.credHash = credHash
7.   if "Capture OAuth token for per-shell use?" -> captureOAuthToken(); profile.hasToken  // unchanged
   finally:
8.   prev ? writeLiveCredential(prev) : neutralizeLiveCredential()   // ALWAYS runs
```

The `finally` guarantees the machine is never left silently logged in as the
freshly-captured account, on any exit path (success, cancel, non-zero exit, failed
status, null capture, or a thrown error). If capture fails, `add` throws and saves no
profile. The subsequent isolate-config + `saveProfile` steps (`cli.ts:246-262`) are
reached only on success and are unchanged.

## Components

- **`exec.ts`** — add `runInteractive(cmd, args, deps?)`: `spawn` with
  `stdio: 'inherit'`, resolve `{ code }` on close. Injectable for tests.
- **`credentials.ts`** — reuse `readLiveCredential`, `writeLiveCredential`,
  `neutralizeLiveCredential` (all already exist). Optionally add a thin
  `readAuthStatus(deps)` helper that runs `claude auth status --json` and returns the
  parsed object (or `{ loggedIn: false }` on non-zero/parse failure).
- **`cli.ts`** — rewrite the `login` branch of the `add` action (lines ~220-245) per
  the flow above. `fingerprint`/`hashCredential`, `findDuplicateLoginName`, and the
  per-shell token capture are unchanged.

## Error handling

- Non-zero exit from `claude auth login`, `loggedIn !== true`, or a null credential
  read each throw a clear one-line error; no profile is saved.
- The `prev` restore is in a `finally`, so it runs even when those throws fire.
- `claude auth status --json` that fails to run or parse is treated as
  `loggedIn: false` (safe: aborts and restores).

## Testing

`runInteractive` and the status read are injected, so no real process is spawned.
New unit tests:

- Success: login → capture → profile saved with `credHash`; `prev` restored to the
  live slot afterward.
- `prev` was null: after capture, live slot is neutralized (not left set).
- Non-zero exit from `claude auth login`: no profile saved; `prev` restored.
- `loggedIn: false` in status: no profile saved; `prev` restored.
- Duplicate credential (`credHash` matches existing profile): duplicate prompt fires;
  declining aborts without save.

Existing `add` tests for `api-key`, `bedrock`, and `bedrock-key` paths are untouched.

## Out of scope

- `--email` / `--console` / `--sso` flags on `claude auth login`.
- Any change to the api-key / bedrock / bedrock-key add branches.
- Changing how `switch`/global-active state is tracked.
