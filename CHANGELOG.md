# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-07-24

### Fixed

- `ccswitch --version` reported `0.1.0` on the 0.2.0 release. The version was a
  hardcoded literal in `src/cli.ts` and silently desynced from `package.json` at
  the version bump. It is now read from `package.json` at runtime, which
  resolves correctly from both the source tree and the published bundle, and a
  test pins the two together so they cannot drift again.

## [0.2.0] - 2026-07-24

### Added

- **New `custom` auth type** for Anthropic-compatible endpoints — DeepSeek,
  Moonshot, OpenRouter, self-hosted vLLM, corporate proxies. Sets
  `ANTHROPIC_BASE_URL` and authenticates with `ANTHROPIC_AUTH_TOKEN`, which the
  `api-key` type cannot do (it is hardwired to `api.anthropic.com`). Available
  through `ccswitch add`, `ccswitch save <name> --type custom`, `ccswitch env`
  and `ccuse`. Thanks to [@iPurpl3x](https://github.com/iPurpl3x) ([#1]).
- **Model routing overrides** for custom endpoints, since third-party providers
  rarely use Anthropic's model names. `ANTHROPIC_MODEL`,
  `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL` and `CLAUDE_CODE_SUBAGENT_MODEL`
  can be pinned per profile. Any other key is rejected, so a typo cannot inject
  arbitrary settings ([#1]).
- **`doctor` now detects custom-endpoint leakage.** An `ANTHROPIC_AUTH_TOKEN`
  left in `settings.json` while a non-custom profile is active is reported as an
  error (it overrides that profile's credentials); a leftover
  `ANTHROPIC_BASE_URL` is reported as a warning, since its credentials would be
  sent to that endpoint. This catches base URLs and tokens that reached
  `settings.json` some way other than a switch — a hand-edit, or a
  `save --type custom` on a profile that was never activated — which the
  managed-key mechanism cannot clear on its own.
- `doctor` shows the endpoint `base url:` for an active custom profile, and a
  masked credential preview for custom profiles alongside `api-key` and
  `bedrock-key`.

### Fixed

- **`save --type custom` no longer leaves a plaintext token behind.** It moves
  `ANTHROPIC_AUTH_TOKEN` into the OS secret store and deletes the plaintext copy
  from `settings.json`. Previously the copy survived, and because `switch` only
  clears keys it previously managed, it outlived a later switch — silently
  authenticating the next profile against the custom endpoint. The command now
  prints how to restore it (`ccswitch <name>`).

### Changed

- `ANTHROPIC_BASE_URL` and the model-routing keys are now **managed keys**, so
  switching to any other profile clears them. Without this a stale base URL from
  a custom endpoint would reroute a subscription profile — sending its OAuth
  credential to a third-party host ([#1]).
- `ccswitch env --unset` and `ccuse --unset` also clear `ANTHROPIC_BASE_URL` and
  the model-routing keys ([#1]).

### Documentation

- New [Custom endpoint](https://olayemii.github.io/ccswitch/auth-types/custom/)
  auth-type guide, plus custom-endpoint coverage in the `add`, `save`, `env`,
  `doctor`, `refresh` and `list` command pages, the credential-storage concept
  page, and the README.
- Documented two existing limitations: switching to a `custom` profile runs no
  liveness probe, and `ccswitch refresh` is `bedrock-key`-only (rotate a custom
  token with `ccswitch add --force`).

## [0.1.0] - 2026-07-11

Initial release.

### Added

- Global and per-shell profile switching for Claude Code across macOS, Windows
  and Linux.
- Auth types: `login` (subscription OAuth), `api-key`, `bedrock` (AWS SigV4
  credentials) and `bedrock-key` (Bedrock bearer token).
- Secrets held in the OS secret store — macOS keychain, Windows Credential
  Manager, libsecret on Linux — never in profile JSON.
- Expiry tracking for short-lived Bedrock tokens, with blocking on switch to an
  expired profile and `ccswitch refresh` to replace one in place.
- Liveness probes: Anthropic API key validation and `aws sts get-caller-identity`
  for SigV4 profiles, skippable with `--no-check`.
- `ccswitch doctor` for configuration drift diagnosis, `ccswitch shellinit` /
  `ccuse` for per-shell switching, and optional per-profile config isolation via
  `CLAUDE_CONFIG_DIR`.

[#1]: https://github.com/olayemii/ccswitch/pull/1
[0.2.1]: https://github.com/olayemii/ccswitch/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/olayemii/ccswitch/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/olayemii/ccswitch/releases/tag/v0.1.0
