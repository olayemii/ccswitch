# ccswitch — Claude account switcher

[![npm version](https://img.shields.io/npm/v/@olayemii/ccswitch.svg?color=f59e0b)](https://www.npmjs.com/package/@olayemii/ccswitch)
[![license: MIT](https://img.shields.io/badge/license-MIT-f59e0b.svg)](LICENSE)
[![docs](https://img.shields.io/badge/docs-olayemii.github.io%2Fccswitch-f59e0b.svg)](https://olayemii.github.io/ccswitch/)

**📖 Docs & guide → https://olayemii.github.io/ccswitch/**

Switch the active Claude Code account between any number of profiles —
subscription logins, API keys, Bedrock (AWS credentials), Bedrock API keys,
and custom Anthropic-compatible endpoints — across macOS, Windows, and Linux.
Supports two modes:

- **Global switch** — change the active account for the whole machine (CLI,
  desktop app, IDE extensions all follow it). One active account at a time.
- **Per-shell** — set the account for the current terminal only, so different
  accounts can run in parallel windows.

## Install

```bash
npm install -g @olayemii/ccswitch
```

Or from source:

```bash
git clone https://github.com/olayemii/ccswitch.git
cd ccswitch
npm install && npm run build && npm link
```

Either way puts `ccswitch` on your `PATH` (bin entry `ccswitch` → `dist/bin.js`).
Requires Node >= 18.

## Commands

```
ccswitch                    interactive picker → global switch
ccswitch <name>             global switch directly
ccswitch env <name>         print export statements for the current shell
ccswitch env --unset        print unset statements to clear this shell
ccswitch shellinit          print a shell function (ccuse) for convenience
ccswitch save <name> --type <login|api-key|bedrock|bedrock-key|custom>
                            snapshot current live state into a profile
                            (--type is required; bedrock-key reads
                            $AWS_BEARER_TOKEN_BEDROCK from the environment)
ccswitch add                guided setup (login / api-key / bedrock /
                            bedrock-key / custom; config isolation; optional
                            token capture)
ccswitch help               overview of auth types and common commands
ccswitch token <name>       capture a long-lived OAuth token (claude setup-token)
                            for a login profile, enabling per-shell on macOS
ccswitch refresh <name>     replace a bedrock-key profile's bearer token in
                            place and re-derive its expiry (reads --token or
                            $AWS_BEARER_TOKEN_BEDROCK)
ccswitch list               show profiles, mark the active one, show types
ccswitch current            print active profile
ccswitch doctor             diagnose active profile (name, type, config,
                            masked credential, account, token age)
ccswitch remove <name>      delete a profile (+ its secret and isolated dir)
```

## Global switch

```bash
ccswitch <name>
```

Backs up the current `settings.json` (timestamped), patches only the managed
keys it controls, applies the profile's credential (login / api-key /
bedrock), and writes the active-profile pointer. Affects the CLI, desktop
app, and IDE extensions since they read the shared config and credential
store.

**Caveats:**
- The desktop app and IDE cache the token in memory — restart them after a
  global switch.
- When switching **from** a Bedrock profile **to** a non-Bedrock profile (login
  or api-key), environment variables like `CLAUDE_CODE_USE_BEDROCK` and
  `AWS_BEARER_TOKEN_BEDROCK` may persist in your current shell session and take
  precedence over the new profile. Open a new terminal to ensure the switch
  takes effect, or manually unset the environment variables:
  ```bash
  unset CLAUDE_CODE_USE_BEDROCK AWS_BEARER_TOKEN_BEDROCK AWS_REGION AWS_PROFILE
  ```

## Doctor

```bash
ccswitch doctor
```

Diagnoses the active profile, showing its authentication details and configuration:

```
Active profile details:
  name:        work
  type:        bedrock-key
  config dir:  (default)
  credential:  sk-ant…a3f9 (len 108)
```

Fields shown depend on profile type:
- **All types:** name, type, config directory (path or "(default)")
- **api-key / bedrock-key / custom:** `credential:` — a masked preview of the stored secret (first 6 characters + last 4 characters + total length; secrets under 12 characters show only the last 4 characters)
- **custom:** `base url:` — the endpoint the profile points at
- **login:** `account:` (email — org, or email alone) and `token:` (captured N days ago (YYYY-MM-DD), or "present, capture date unknown", or "none captured")
- **No active profile:** a single line: `No active profile.`

Secrets are always masked — a full secret is never printed.

## Per-shell switch

```bash
eval "$(ccswitch env <name>)"
```

Prints `export` statements for the current shell only — nothing global
changes. This is what lets you run different accounts in parallel terminal
windows. To clear a shell's overrides:

```bash
eval "$(ccswitch env --unset)"
```

### `ccuse` helper

To avoid typing the `eval "$(...)"` line every time, load the shell function
`ccswitch shellinit` prints, e.g. add this to your shell profile:

```bash
eval "$(ccswitch shellinit)"
```

Then switch a shell with:

```bash
ccuse <name>
```

### Config isolation is per-shell only

`ccswitch add` can give a profile an isolated config dir (its own
`settings.json`, history, and MCP config). Isolation is carried by the
`CLAUDE_CONFIG_DIR` environment variable, so it only takes effect in a shell
that has that variable exported — i.e. via `ccuse <name>` / `ccswitch env
<name>`. A **global** switch (`ccswitch <name>`) cannot set an environment
variable for the desktop app or IDE, so it uses the shared config and prints a
warning reminding you to use `ccuse <name>` if you want the isolated config.

## Bedrock API keys (`bedrock-key`)

Amazon Bedrock API keys authenticate with a bearer token that Claude Code
reads from the `AWS_BEARER_TOKEN_BEDROCK` environment variable (alongside
`CLAUDE_CODE_USE_BEDROCK=1`). This is distinct from the `bedrock` type, which
uses AWS SigV4 credentials via a named `AWS_PROFILE`.

Create one interactively with `ccswitch add` (choose **Bedrock API key**), or
snapshot the token currently in your environment:

```bash
export AWS_BEARER_TOKEN_BEDROCK=<your-bedrock-api-key>
ccswitch save bedrock-prod --type bedrock-key   # also captures $AWS_REGION if set
```

The bearer token is held in the OS secret store (keychain on macOS), not in
the profile JSON. `AWS_REGION` is optional — Claude Code falls back to your
profile's region, then `us-east-1`.

**Plaintext caveat for global switch.** Claude Code has no runtime helper that
can source a Bedrock bearer token from a command (unlike `apiKeyHelper` for
API keys, which is skipped entirely when `CLAUDE_CODE_USE_BEDROCK=1`). So a
global `ccswitch bedrock-prod` writes `AWS_BEARER_TOKEN_BEDROCK` into
`settings.json` in **plaintext**. It is a managed key, so switching to any
other profile removes it again — the token only sits on disk while the
`bedrock-key` profile is the active global profile. The per-shell flow
(`ccuse bedrock-prod`) keeps the token in the keychain and exports it only
into that shell.

## Short-lived Bedrock tokens

Short-term Bedrock API keys (`bedrock-api-key-…`) carry an embedded expiry
(commonly 12 hours). ccswitch reads that expiry automatically when you `save`,
`add`, or `refresh` a `bedrock-key` profile — no extra prompts — and records it
on the profile.

- **doctor / list** show the remaining time, e.g. `expires: in 3h`,
  `EXPIRING (12m)`, or `EXPIRED (2h ago)`.
- **Switching** to an expired `bedrock-key` profile (globally or via
  `ccswitch env`) is **blocked** with a message pointing at `ccswitch refresh`.
- **`ccswitch refresh <name>`** stores a fresh token (from `--token` or
  `$AWS_BEARER_TOKEN_BEDROCK`) in place and re-derives the expiry, without
  recreating the profile.

Long-term keys (`ABSK…`) and any token whose expiry can't be parsed are left
**untracked** — no warnings and no blocking, exactly as before.

For the SigV4 `bedrock` type (AWS credentials behind a named `AWS_PROFILE`),
ccswitch doesn't hold the credentials, so it can't track their expiry. Pass
`--check` on a global switch to run an opt-in `aws sts get-caller-identity`
liveness probe that warns (never blocks) if the credentials look stale:

```bash
ccswitch my-bedrock-profile --check
```

## Custom Anthropic-compatible endpoints (`custom`)

A `custom` profile points Claude Code at any Anthropic-compatible API —
DeepSeek, Moonshot, OpenRouter, a self-hosted vLLM, or a corporate proxy. It
sets `ANTHROPIC_BASE_URL` and authenticates with `ANTHROPIC_AUTH_TOKEN`. The
`api-key` type can't do this: it always talks to `api.anthropic.com`.

Create one with `ccswitch add` (choose **Custom Anthropic-compatible
endpoint**), which prompts for the base URL, the token, and optional model
overrides. Or snapshot what's already in `settings.json`:

```bash
ccswitch save deepseek --type custom
```

Because endpoints rarely use Anthropic's model names, a profile can pin its
own via a comma-separated `KEY=value` list at the `add` prompt:

```
ANTHROPIC_MODEL=deepseek-v4-pro,ANTHROPIC_DEFAULT_HAIKU_MODEL=deepseek-v4-flash
```

Only `ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL` and
`CLAUDE_CODE_SUBAGENT_MODEL` are accepted — anything else is rejected, so a
typo can't inject arbitrary settings.

The token lives in the OS secret store; the profile JSON holds only the base
URL and model overrides. Global switch has the same **plaintext caveat** as
`bedrock-key` — the token is written into `settings.json` while the profile is
active. All of these keys are managed, so switching to another profile clears
them; that matters more here than elsewhere, because a leftover
`ANTHROPIC_BASE_URL` would send the next profile's credentials to this
endpoint. `ccswitch doctor` reports that situation if a base URL or token ever
reaches `settings.json` some way other than a switch.

Two rough edges worth knowing: switching to a `custom` profile runs **no
liveness probe** (endpoints vary too much for a shared health check), and
`ccswitch refresh` is `bedrock-key`-only — rotate a custom token with
`ccswitch add --force`.

## macOS keychain caveat

On macOS, subscription logins are stored in the encrypted login keychain,
which is a single global slot — it is not isolated per shell or per
`CLAUDE_CONFIG_DIR`. This means two different subscription *logins* cannot be
simultaneously live via the keychain on macOS: per-shell parallelism for a
login profile requires a captured long-lived OAuth token instead of the live
keychain credential.

Run `ccswitch token <name>` (wraps `claude setup-token`) to capture a token
for a login profile before using `ccswitch env <name>` on macOS. Without a
captured token, `env` will explain this and refuse to proceed for a login
profile.

**On all platforms — macOS, Windows, and Linux — `ccswitch env <name>` for a
`login` profile requires a captured OAuth token.** Per-shell mode works by
exporting `CLAUDE_CODE_OAUTH_TOKEN` into the shell; if the profile has no
captured token, `ccswitch env <name>` throws `Profile '<name>' has no
captured OAuth token. Run: ccswitch token <name>` regardless of OS. Run
`ccswitch token <name>` first on any platform to enable per-shell use of a
login profile.

**Known limitation:** the original design envisioned Windows/Linux login
profiles being usable per-shell via an isolated, per-profile
`CLAUDE_CONFIG_DIR` (each with its own `.credentials.json`) *without* needing
a captured token, since `.credentials.json` moves with `CLAUDE_CONFIG_DIR` on
those platforms. That path is not implemented in the current build —
`buildEnvExport` in `src/envexport.ts` has no platform branch and always
requires `profile.hasToken` plus a stored secret for `type: 'login'`, so
token capture is required for per-shell login switching everywhere today.

## Development

```bash
npx vitest run     # run the test suite
npm run typecheck   # tsc --noEmit
npm run build       # bundle with tsup → dist/bin.js
```
