# ccswitch — Claude account switcher

**Date:** 2026-07-09
**Status:** Approved design, ready for implementation planning

## Purpose

A standalone CLI, `ccswitch`, that lets a user switch the active Claude Code
account between any number of profiles — subscription logins (work, personal),
API keys, and Bedrock — across macOS, Windows, and Linux. It supports two modes:

- **Global switch** — change the active account for the whole machine (terminal
  CLI, desktop app, IDE extensions all follow it). One active account at a time.
- **Per-shell** — set the account for the current terminal only, so different
  accounts can run in parallel windows.

## Goals

- Switch between arbitrary profiles of **any** auth type: subscription OAuth
  login, `ANTHROPIC_API_KEY`, or Bedrock (`CLAUDE_CODE_USE_BEDROCK` + AWS).
- Global mode: one clear "active account" model, affecting the app/IDE too.
- Per-shell mode: run different accounts simultaneously in different terminals.
- Cross-platform: macOS, Windows, Linux.
- Optional per-profile config isolation (separate settings/history/MCP).
- Never store secrets in plaintext files the tool itself controls.
- Never clobber the parts of `settings.json` the user manages themselves.

## Non-goals (YAGNI)

- Vertex AI / Microsoft Foundry provider modes (only Bedrock for cloud). Easy to
  add later — same env-var pattern.
- A full TUI. A simple interactive picker is enough.

## Auth mechanics this relies on

Verified against Claude Code docs (authentication precedence, credential
management, config directory).

**Authentication precedence** (higher overrides lower):

1. Cloud provider — `CLAUDE_CODE_USE_BEDROCK` (+ `AWS_PROFILE`, `AWS_REGION`).
2. `ANTHROPIC_AUTH_TOKEN` (bearer, for gateways).
3. `ANTHROPIC_API_KEY`.
4. `apiKeyHelper` script in `settings.json`
   (`CLAUDE_CODE_API_KEY_HELPER_TTL_MS` controls refresh).
5. `CLAUDE_CODE_OAUTH_TOKEN` — long-lived OAuth token from `claude setup-token`.
6. Subscription OAuth login via `/login` (stored credential).

Because env-var methods (1–5) override the stored login (6) and are per-process,
they are the mechanism that makes **per-shell** switching possible everywhere.

**Credential storage by platform** (the key asymmetry):

- **macOS:** encrypted login **keychain**, a single global slot. It is *not*
  isolated by `CLAUDE_CONFIG_DIR`, and there is no documented way to force a
  file-based store. Consequence: two different subscription *logins* cannot be
  simultaneously live via the keychain on macOS — per-shell parallelism for a
  login requires a captured `CLAUDE_CODE_OAUTH_TOKEN`.
- **Windows / Linux:** `~/.claude/.credentials.json` (permission-locked). This
  file **does** move with `CLAUDE_CONFIG_DIR`, so full per-shell isolation of
  every auth type works by pointing each shell at its own config dir.

**`CLAUDE_CONFIG_DIR`** relocates `settings.json`, history, project state, and
MCP config (`.claude.json`). On Windows/Linux it also relocates
`.credentials.json`; on macOS it does not affect the keychain.

## Two modes

### Global switch (`ccswitch <name>`)

Changes the active account for the whole machine. Affects the CLI, desktop app,
and IDE extensions because they read the shared config + credential store.

Steps:

1. Back up the active `settings.json` (timestamped).
2. Patch only the **managed keys** in `settings.json` `env` and `apiKeyHelper`
   for the target profile; preserve everything else (a stored `managedKeys`
   list prevents clobbering the user's own env vars).
3. Apply the credential:
   - **login** → restore the profile's stored OAuth credential into the live
     credential store (keychain on macOS; `.credentials.json` elsewhere).
   - **api-key** → point `apiKeyHelper` at a script that reads the key from the
     platform secret store; neutralize the live login so it can't take
     precedence.
   - **bedrock** → set `CLAUDE_CODE_USE_BEDROCK=1`, `AWS_PROFILE`,
     `AWS_REGION`; neutralize the live login.
4. Write the active-profile pointer.

**Documented caveat:** the desktop app and IDE cache the token in memory;
restart them after a global switch. A fresh terminal `claude` picks it up
immediately.

### Per-shell (`eval "$(ccswitch env <name>)"`)

Prints shell `export` statements for the current terminal only — nothing global
changes. Enables different accounts in parallel windows.

- **api-key** → `export ANTHROPIC_API_KEY=...` (value read from secret store).
- **bedrock** → `export CLAUDE_CODE_USE_BEDROCK=1 AWS_PROFILE=... AWS_REGION=...`.
- **login** → `export CLAUDE_CODE_OAUTH_TOKEN=...` (requires a token captured
  via `claude setup-token`; this is what makes a login shell-parallel on macOS).
- If the profile has an isolated `configDir`, also
  `export CLAUDE_CONFIG_DIR=...`.

A convenience `ccswitch env --unset` prints `unset` statements to clear them.
A shell helper (`ccswitch shellinit` prints a function) can wrap the eval so the
user types `ccuse work` instead of the full `eval` line.

## Secret handling by platform

An abstraction (`secretStore`) hides the platform difference behind
`get/set/delete(profile)`:

- **macOS:** the profile's secret (OAuth cred JSON, API key, or captured OAuth
  token) is kept in the login keychain under service `ccswitch:<name>`.
- **Windows / Linux:** kept in a permission-locked (0600) file under
  `~/.ccswitch/secrets/<name>` (mirroring how Claude Code itself stores
  `.credentials.json`).

Bedrock profiles hold no secret in this tool — AWS credentials live in `~/.aws`,
managed by the AWS CLI.

Non-secret profile metadata (name, type, env fragment, optional `configDir`,
whether an OAuth token is captured) lives in
`~/.ccswitch/profiles/<name>.json`. The active pointer lives in
`~/.ccswitch/active`.

## Optional per-profile config isolation

Each profile may set `configDir`:

- **Shared (default):** uses the normal `~/.claude`. Global switch only swaps the
  identity; settings/history/MCP are shared across accounts.
- **Isolated:** a dedicated dir (e.g. `~/.ccswitch/homes/<name>`). Global switch
  and per-shell both export `CLAUDE_CONFIG_DIR` to point there, giving separate
  settings, history, and MCP auth per account. On Windows/Linux this also
  isolates credentials; on macOS credentials still route through the keychain
  (documented).

`ccswitch add` can seed an isolated dir by copying the current `~/.claude`
(minus credentials) so the profile starts from the user's existing setup.

## Commands

```
ccswitch                    interactive picker → global switch
ccswitch <name>             global switch directly
ccswitch env <name>         print export statements for the current shell
ccswitch env --unset        print unset statements to clear this shell
ccswitch shellinit          print a shell function (ccuse) for convenience
ccswitch save <name>        snapshot current live state into a profile
ccswitch add                guided setup (login / api-key / bedrock; config
                            isolation; optional token capture)
ccswitch token <name>       capture a long-lived OAuth token (claude setup-token)
                            for a login profile, enabling per-shell on macOS
ccswitch list               show profiles, mark the active one, show types
ccswitch current            print active profile
ccswitch remove <name>      delete a profile (+ its secret and isolated dir)
```

### Capture: both methods

- `save <name>` snapshots whatever is currently live — reads the active
  credential (keychain/file) and the managed env from `settings.json` — and
  stores it as the named profile.
- `add` runs guided setup: choose auth type, collect the right fields (OAuth
  captured from live state; API key entered and stored to the secret store;
  Bedrock collects `AWS_PROFILE`/`AWS_REGION`), choose shared vs isolated config,
  and optionally capture an OAuth token for per-shell use.

## Code shape (isolated, testable units)

- `platform.ts` — OS detection; resolves config-dir, credential-file, and
  keychain availability per platform.
- `secretStore.ts` — `get/set/delete` secrets behind a platform-agnostic API
  (keychain on macOS, 0600 file elsewhere).
- `credentials.ts` — read/write/neutralize the *live* Claude credential
  (keychain slot on macOS, `.credentials.json` elsewhere).
- `settings.ts` — load / patch / save `settings.json`; managed-keys logic;
  timestamped backups. Pure, fixture-tested.
- `profiles.ts` — CRUD on the profile store and the active pointer.
- `envexport.ts` — build the per-shell export/unset statements from a profile.
- `switch.ts` — orchestrate a global switch from a profile record.
- `cli.ts` — argument parsing, the interactive picker, and wiring.

Pure logic (settings patching, managed-keys resolution, env-export building) is
unit-tested against fixtures. Platform calls (`security`, filesystem,
`claude setup-token`) sit behind thin wrappers that are mocked in tests.

## Language & packaging

- Node / TypeScript, distributed as a CLI with a `ccswitch` bin entry,
  installable/linkable onto PATH. Cross-platform (no shell-only assumptions in
  core logic; shell-specific output is confined to `envexport`/`shellinit`).

## Error handling

- Unknown profile on switch → error, suggest `ccswitch list`.
- `save`/`add` for an existing name → require `--force`.
- Live credential read fails during `save` → clear message (user may not be
  logged in).
- `env <name>` for a login profile without a captured token on macOS → explain
  that per-shell login needs `ccswitch token <name>` first.
- Every `settings.json` write is preceded by a backup; a failed patch leaves the
  original intact.
