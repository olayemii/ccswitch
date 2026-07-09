# ccswitch — Claude account switcher

Switch the active Claude Code account between any number of profiles —
subscription logins, API keys, and Bedrock — across macOS, Windows, and
Linux. Supports two modes:

- **Global switch** — change the active account for the whole machine (CLI,
  desktop app, IDE extensions all follow it). One active account at a time.
- **Per-shell** — set the account for the current terminal only, so different
  accounts can run in parallel windows.

## Install

```bash
npm install
npm run build
npm link
```

This puts `ccswitch` on your `PATH` (bin entry `ccswitch` → `dist/bin.js`).
Requires Node >= 18.

## Commands

```
ccswitch                    interactive picker → global switch
ccswitch <name>             global switch directly
ccswitch env <name>         print export statements for the current shell
ccswitch env --unset        print unset statements to clear this shell
ccswitch shellinit          print a shell function (ccuse) for convenience
ccswitch save <name> --type <login|api-key|bedrock>
                            snapshot current live state into a profile
                            (--type is required)
ccswitch add                guided setup (login / api-key / bedrock; config
                            isolation; optional token capture)
ccswitch token <name>       capture a long-lived OAuth token (claude setup-token)
                            for a login profile, enabling per-shell on macOS
ccswitch list               show profiles, mark the active one, show types
ccswitch current            print active profile
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

**Caveat:** the desktop app and IDE cache the token in memory — restart them
after a global switch. A fresh terminal picks up the change immediately.

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
