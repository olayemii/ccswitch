# Short-lived Bedrock credential handling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ccswitch detect when a stored Bedrock bearer token is expired or near expiry — with zero extra user steps — and surface it in `doctor`/`list`, warn at switch time, block activation of a confidently-expired token, and add a `refresh` command for painless re-paste.

**Architecture:** A new pure module `src/bedrockExpiry.ts` derives an absolute expiry from a short-term Bedrock API key (base64-decode the `bedrock-api-key-<...>` bearer token and read the embedded SigV4 `X-Amz-Date` + `X-Amz-Expires`) and computes an expiry *status* from a profile's stored `credExpiresAt`. All four surfaces (doctor, list, switch, env) read from those pure functions — mirroring the existing `src/tokenAge.ts` pattern. When expiry can't be derived (long-term `ABSK…` keys or garbage), the profile is silently *untracked*: no warnings, no blocking.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Node ≥ 18 built-ins only, Vitest, Commander, `@clack/prompts`. Bundled with tsup.

## Global Constraints

- Node ≥ 18; use only Node built-ins (no new dependencies).
- ESM: all intra-repo imports use the `.js` extension (e.g. `from './bedrockExpiry.js'`).
- Pure functions take an explicit `now: Date` — never call `new Date()` inside them (matches `tokenAge.ts`).
- Secrets are never printed. Expiry surfaces show only timestamps/durations, never token bytes.
- `credExpiresAt` absent on a profile means "untracked" — behaves exactly as today (no warnings, no blocking). No migration.
- Blocking applies to `type: 'bedrock-key'` only, and only when status is confidently `expired`.
- Run `npx vitest run` and `npm run typecheck` before every commit; both must pass.
- Commit style: conventional commits (`feat:`, `fix:`, `docs:`), matching repo history.

---

### Task 1: Expiry derivation + status module (`src/bedrockExpiry.ts`)

**Files:**
- Create: `src/bedrockExpiry.ts`
- Modify: `src/types.ts:4-13` (add `credExpiresAt?` to `Profile`)
- Test: `test/bedrockExpiry.test.ts`

**Interfaces:**
- Consumes: `Profile` from `./types.js`.
- Produces:
  - `deriveBedrockKeyExpiry(token: string): string | null` — absolute ISO 8601 expiry, or `null` when not derivable.
  - `type BedrockExpiryState = 'fresh' | 'expiring' | 'expired' | 'untracked'`
  - `BEDROCK_EXPIRING_MS: number` (= 30 min)
  - `bedrockExpiryStatus(profile: Profile, now: Date): { state: BedrockExpiryState; expiresInMs: number | null }` — `expiresInMs` is signed (positive = time remaining, negative = time since expiry), `null` when untracked.
  - `describeBedrockExpiry(profile: Profile, now: Date): string | null` — short human badge (`'in 3h'`, `'EXPIRING (12m)'`, `'EXPIRED (2h ago)'`), or `null` when untracked.
  - `bedrockExpiredMessage(profile: Profile, now: Date): string | null` — the block/error message when `expired`, else `null`.
  - `bedrockExpiringWarning(profile: Profile, now: Date): string | null` — the loud non-blocking switch-time warning when `expiring`, else `null`.

- [ ] **Step 1: Add the `credExpiresAt` field to `Profile`**

In `src/types.ts`, add one field to the `Profile` interface (after `tokenCapturedAt?: string` on line 10):

```ts
  credExpiresAt?: string   // absolute ISO 8601 expiry for a short-lived bedrock-key token; absent = untracked
```

- [ ] **Step 2: Write the failing test for `deriveBedrockKeyExpiry`**

Create `test/bedrockExpiry.test.ts`. This builds a real short-term-key shape (prefix + base64 of a presigned query string) so the parser is exercised end-to-end.

```ts
import { describe, it, expect } from 'vitest'
import {
  deriveBedrockKeyExpiry,
  bedrockExpiryStatus,
  describeBedrockExpiry,
  bedrockExpiredMessage,
  BEDROCK_EXPIRING_MS,
} from '../src/bedrockExpiry.js'
import type { Profile } from '../src/types.js'

// A short-term Bedrock API key is `bedrock-api-key-<base64(presigned URL)>`.
// The presigned URL query carries X-Amz-Date (YYYYMMDDTHHMMSSZ) and
// X-Amz-Expires (seconds). Build one so expiry = date + expires seconds.
function shortTermKey(amzDate: string, expiresSec: number): string {
  const url =
    'https://bedrock-runtime.us-east-1.amazonaws.com/?' +
    'X-Amz-Algorithm=AWS4-HMAC-SHA256' +
    `&X-Amz-Date=${amzDate}` +
    `&X-Amz-Expires=${expiresSec}` +
    '&X-Amz-SignedHeaders=host&X-Amz-Signature=deadbeef'
  return 'bedrock-api-key-' + Buffer.from(url, 'utf8').toString('base64')
}

describe('deriveBedrockKeyExpiry', () => {
  it('computes absolute expiry from X-Amz-Date + X-Amz-Expires', () => {
    // 2026-07-11T00:00:00Z + 12h = 2026-07-11T12:00:00Z
    const key = shortTermKey('20260711T000000Z', 43200)
    expect(deriveBedrockKeyExpiry(key)).toBe('2026-07-11T12:00:00.000Z')
  })

  it('returns null for a long-term ABSK key (no embedded expiry)', () => {
    expect(deriveBedrockKeyExpiry('ABSK' + Buffer.from('iam-user-info').toString('base64'))).toBeNull()
  })

  it('returns null for garbage', () => {
    expect(deriveBedrockKeyExpiry('not-a-real-token')).toBeNull()
  })

  it('returns null when the decoded URL lacks the signing params', () => {
    const key = 'bedrock-api-key-' + Buffer.from('https://x/?foo=bar', 'utf8').toString('base64')
    expect(deriveBedrockKeyExpiry(key)).toBeNull()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/bedrockExpiry.test.ts`
Expected: FAIL — `deriveBedrockKeyExpiry` (and the other imports) not defined / module missing.

- [ ] **Step 4: Implement `src/bedrockExpiry.ts`**

Create `src/bedrockExpiry.ts`:

```ts
import type { Profile } from './types.js'

// Tokens within this window of expiry are surfaced as "expiring" — a loud but
// non-blocking heads-up, mirroring TOKEN_STALE_DAYS in tokenAge.ts.
export const BEDROCK_EXPIRING_MS = 30 * 60 * 1000

const SHORT_TERM_PREFIX = 'bedrock-api-key-'

// Parse an AWS SigV4 amz date (YYYYMMDDTHHMMSSZ) into epoch ms, or null.
function parseAmzDate(v: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(v)
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m
  const ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)
  return Number.isNaN(ms) ? null : ms
}

// Derive an absolute ISO expiry from a short-term Bedrock API key. Short-term
// keys are `bedrock-api-key-<base64(presigned URL)>`; the URL query carries
// X-Amz-Date and X-Amz-Expires (seconds). Long-term `ABSK…` keys and anything
// unparseable return null (the caller treats that as "untracked").
export function deriveBedrockKeyExpiry(token: string): string | null {
  if (!token.startsWith(SHORT_TERM_PREFIX)) return null
  let decoded: string
  try {
    decoded = Buffer.from(token.slice(SHORT_TERM_PREFIX.length), 'base64').toString('utf8')
  } catch {
    return null
  }
  const q = decoded.indexOf('?')
  if (q === -1) return null
  const params = new URLSearchParams(decoded.slice(q + 1))
  const amzDate = params.get('X-Amz-Date')
  const expiresSec = params.get('X-Amz-Expires')
  if (!amzDate || !expiresSec) return null
  const start = parseAmzDate(amzDate)
  const secs = Number(expiresSec)
  if (start === null || !Number.isFinite(secs)) return null
  return new Date(start + secs * 1000).toISOString()
}

export type BedrockExpiryState = 'fresh' | 'expiring' | 'expired' | 'untracked'

// Signed status for a profile's stored expiry. expiresInMs is positive when
// time remains, negative once expired, null when untracked. Only bedrock-key
// profiles with a recorded credExpiresAt are ever tracked.
export function bedrockExpiryStatus(
  profile: Profile,
  now: Date,
): { state: BedrockExpiryState; expiresInMs: number | null } {
  if (profile.type !== 'bedrock-key' || !profile.credExpiresAt) {
    return { state: 'untracked', expiresInMs: null }
  }
  const exp = Date.parse(profile.credExpiresAt)
  if (Number.isNaN(exp)) return { state: 'untracked', expiresInMs: null }
  const remaining = exp - now.getTime()
  const state: BedrockExpiryState =
    remaining <= 0 ? 'expired' : remaining <= BEDROCK_EXPIRING_MS ? 'expiring' : 'fresh'
  return { state, expiresInMs: remaining }
}

// Whole-unit duration like "3h", "12m", or "0m" (minutes under an hour, hours otherwise).
function humanizeMs(ms: number): string {
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h`
}

// Short badge for doctor/list, or null when untracked.
export function describeBedrockExpiry(profile: Profile, now: Date): string | null {
  const { state, expiresInMs } = bedrockExpiryStatus(profile, now)
  if (state === 'untracked' || expiresInMs === null) return null
  if (state === 'expired') return `EXPIRED (${humanizeMs(-expiresInMs)} ago)`
  if (state === 'expiring') return `EXPIRING (${humanizeMs(expiresInMs)})`
  return `in ${humanizeMs(expiresInMs)}`
}

// Block/error message when a bedrock-key token is confidently expired, else null.
export function bedrockExpiredMessage(profile: Profile, now: Date): string | null {
  const { state, expiresInMs } = bedrockExpiryStatus(profile, now)
  if (state !== 'expired' || expiresInMs === null) return null
  return (
    `Profile '${profile.name}' Bedrock token expired ${humanizeMs(-expiresInMs)} ago. ` +
    `Refresh it: ccswitch refresh ${profile.name}`
  )
}

// Loud but non-blocking heads-up when a token is within the expiring window, else null.
export function bedrockExpiringWarning(profile: Profile, now: Date): string | null {
  const { state, expiresInMs } = bedrockExpiryStatus(profile, now)
  if (state !== 'expiring' || expiresInMs === null) return null
  return (
    `Profile '${profile.name}' Bedrock token expires in ${humanizeMs(expiresInMs)}. ` +
    `Refresh soon: ccswitch refresh ${profile.name}`
  )
}
```

- [ ] **Step 5: Add status/describe/message tests**

Append to `test/bedrockExpiry.test.ts`:

```ts
const NOW = new Date('2026-07-11T00:00:00Z')
function keyProfile(overrides: Partial<Profile> = {}): Profile {
  return { name: 'work', type: 'bedrock-key', env: {}, ...overrides }
}
function atOffsetMs(ms: number): string {
  return new Date(NOW.getTime() + ms).toISOString()
}

describe('bedrockExpiryStatus', () => {
  it('is untracked without credExpiresAt', () => {
    expect(bedrockExpiryStatus(keyProfile(), NOW).state).toBe('untracked')
  })

  it('is untracked for non-bedrock-key profiles even with credExpiresAt', () => {
    const p: Profile = { name: 'k', type: 'api-key', env: {}, credExpiresAt: atOffsetMs(60_000) }
    expect(bedrockExpiryStatus(p, NOW).state).toBe('untracked')
  })

  it('is fresh well before expiry', () => {
    expect(bedrockExpiryStatus(keyProfile({ credExpiresAt: atOffsetMs(3 * 3600_000) }), NOW).state).toBe('fresh')
  })

  it('is expiring within the window', () => {
    expect(bedrockExpiryStatus(keyProfile({ credExpiresAt: atOffsetMs(BEDROCK_EXPIRING_MS - 60_000) }), NOW).state).toBe('expiring')
  })

  it('is expired at/after the expiry instant', () => {
    expect(bedrockExpiryStatus(keyProfile({ credExpiresAt: atOffsetMs(-60_000) }), NOW).state).toBe('expired')
  })
})

describe('describeBedrockExpiry', () => {
  it('is null when untracked', () => {
    expect(describeBedrockExpiry(keyProfile(), NOW)).toBeNull()
  })
  it('renders remaining time when fresh', () => {
    expect(describeBedrockExpiry(keyProfile({ credExpiresAt: atOffsetMs(3 * 3600_000) }), NOW)).toBe('in 3h')
  })
  it('renders EXPIRED with elapsed time', () => {
    expect(describeBedrockExpiry(keyProfile({ credExpiresAt: atOffsetMs(-2 * 3600_000) }), NOW)).toBe('EXPIRED (2h ago)')
  })
})

describe('bedrockExpiredMessage', () => {
  it('is null when not expired', () => {
    expect(bedrockExpiredMessage(keyProfile({ credExpiresAt: atOffsetMs(3600_000) }), NOW)).toBeNull()
  })
  it('names the profile and refresh command when expired', () => {
    const m = bedrockExpiredMessage(keyProfile({ credExpiresAt: atOffsetMs(-3600_000) }), NOW)
    expect(m).toContain("Profile 'work' Bedrock token expired")
    expect(m).toContain('ccswitch refresh work')
  })
})

describe('bedrockExpiringWarning', () => {
  it('is null when fresh', () => {
    expect(bedrockExpiringWarning(keyProfile({ credExpiresAt: atOffsetMs(3 * 3600_000) }), NOW)).toBeNull()
  })
  it('is null when already expired (that path blocks instead)', () => {
    expect(bedrockExpiringWarning(keyProfile({ credExpiresAt: atOffsetMs(-60_000) }), NOW)).toBeNull()
  })
  it('warns within the expiring window', () => {
    const w = bedrockExpiringWarning(keyProfile({ credExpiresAt: atOffsetMs(BEDROCK_EXPIRING_MS - 60_000) }), NOW)
    expect(w).toContain("Profile 'work' Bedrock token expires in")
    expect(w).toContain('ccswitch refresh work')
  })
})
```

Add `bedrockExpiringWarning` to the import at the top of this file.

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run test/bedrockExpiry.test.ts && npm run typecheck`
Expected: PASS (all cases green), typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/bedrockExpiry.ts src/types.ts test/bedrockExpiry.test.ts
git commit -m "feat: derive and classify short-lived Bedrock key expiry"
```

---

### Task 2: Capture expiry on `save` and `add`

**Files:**
- Modify: `src/cli.ts:244-248` (`save` bedrock-key branch), `src/cli.ts:298-304` (`add` bedrock-key branch), `src/cli.ts:20-21` (imports)
- Test: `test/cli.test.ts`

**Interfaces:**
- Consumes: `deriveBedrockKeyExpiry` from `./bedrockExpiry.js`.
- Produces: no new exports — profiles created via `save`/`add` for `bedrock-key` now carry `credExpiresAt` when the token is short-term.

- [ ] **Step 1: Write the failing test**

The `test/cli.test.ts` harness (top of file + the `i2`/`e2`/`loadProf` block starting near line 67) exposes: `paths(process.env, 'linux')`, `saveProfile`, `loadProf` (aliased `loadProfile`), `getSec` (aliased `getSecret`), an `out` array capturing stdout, and `runCli([...], { platform: 'linux', env })`. Add a local `shortTermKey` helper (do not cross-import test files) mirroring the existing `bedrock-key` save test at line 84:

```ts
function shortTermKey(amzDate: string, expiresSec: number): string {
  const url = 'https://bedrock-runtime.us-east-1.amazonaws.com/?X-Amz-Algorithm=AWS4-HMAC-SHA256'
    + `&X-Amz-Date=${amzDate}&X-Amz-Expires=${expiresSec}`
    + '&X-Amz-SignedHeaders=host&X-Amz-Signature=deadbeef'
  return 'bedrock-api-key-' + Buffer.from(url, 'utf8').toString('base64')
}

i2('save --type bedrock-key records credExpiresAt from a short-term token', async () => {
  const p = paths(process.env, 'linux')
  const token = shortTermKey('20260711T000000Z', 43200)
  const env = { ...process.env, AWS_BEARER_TOKEN_BEDROCK: token }
  const code = await runCli(['save', 'brk', '--type', 'bedrock-key'], { platform: 'linux', env })
  e2(code).toBe(0)
  e2(loadProf('brk', p).credExpiresAt).toBe('2026-07-11T12:00:00.000Z')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/cli.test.ts -t "credExpiresAt from a short-term"`
Expected: FAIL — `saved.credExpiresAt` is `undefined`.

- [ ] **Step 3: Wire derivation into `save`**

In `src/cli.ts`, add to the imports near line 20:

```ts
import { deriveBedrockKeyExpiry, describeBedrockExpiry, bedrockExpiredMessage, bedrockExpiringWarning } from './bedrockExpiry.js'
```

(`describeBedrockExpiry`, `bedrockExpiredMessage`, and `bedrockExpiringWarning` are used in later tasks; import them now. Task 6 adds `bedrockLivenessWarning` to this same import.)

Change the `save` bedrock-key branch (currently lines 244-248):

```ts
      } else if (opts.type === 'bedrock-key') {
        const token = env.AWS_BEARER_TOKEN_BEDROCK
        if (!token) throw new Error('No AWS_BEARER_TOKEN_BEDROCK in environment to snapshot.')
        await setSecret(name, token, plat, p)
        profile.env = { CLAUDE_CODE_USE_BEDROCK: '1', ...(env.AWS_REGION ? { AWS_REGION: env.AWS_REGION } : {}) }
        const exp = deriveBedrockKeyExpiry(token)
        if (exp) profile.credExpiresAt = exp
      }
```

- [ ] **Step 4: Wire derivation into `add`**

Change the `add` bedrock-key branch (currently lines 298-304):

```ts
      } else if (type === 'bedrock-key') {
        const token = (await clack.password({ message: 'AWS_BEARER_TOKEN_BEDROCK (Bedrock API key)' })) as string
        if (clack.isCancel(token)) return
        const region = (await clack.text({ message: 'AWS_REGION (optional)' })) as string
        if (clack.isCancel(region)) return
        await setSecret(name, token, plat, p)
        profile.env = { CLAUDE_CODE_USE_BEDROCK: '1', ...(region ? { AWS_REGION: region } : {}) }
        const exp = deriveBedrockKeyExpiry(token)
        if (exp) profile.credExpiresAt = exp
      } else if (type === 'bedrock') {
```

- [ ] **Step 5: Run test + typecheck**

Run: `npx vitest run test/cli.test.ts -t "credExpiresAt from a short-term" && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts test/cli.test.ts
git commit -m "feat: record Bedrock key expiry on save and add"
```

---

### Task 3: `ccswitch refresh <name>` command

**Files:**
- Modify: `src/cli.ts` (add a new command, place it right after the `token` command block ending at line 272)
- Test: `test/cli.test.ts`

**Interfaces:**
- Consumes: `loadProfile`, `saveProfile`, `setSecret`, `deriveBedrockKeyExpiry`.
- Produces: CLI command `refresh <name> [--token <t>]`.

- [ ] **Step 1: Write the failing test**

Add to `test/cli.test.ts`, reusing the `shortTermKey` helper from Task 2 and the harness (`paths`, `saveProfile`, `loadProf`, `getSec`, `out`):

```ts
i2('refresh replaces the token in place and updates credExpiresAt', async () => {
  const p = paths(process.env, 'linux')
  saveProfile({ name: 'brk', type: 'bedrock-key', env: { CLAUDE_CODE_USE_BEDROCK: '1' }, credExpiresAt: '2026-07-11T00:00:00.000Z' }, p)
  await setSec('brk', 'old-token', 'linux', p)
  const newToken = shortTermKey('20260712T000000Z', 43200)
  const code = await runCli(['refresh', 'brk', '--token', newToken], { platform: 'linux' })
  e2(code).toBe(0)
  const saved = loadProf('brk', p)
  e2(saved.credExpiresAt).toBe('2026-07-12T12:00:00.000Z')
  e2(saved.type).toBe('bedrock-key')            // profile not recreated
  e2(await getSec('brk', 'linux', p)).toBe(newToken)
})

i2('refresh rejects a non-bedrock-key profile', async () => {
  const p = paths(process.env, 'linux')
  saveProfile({ name: 'api', type: 'api-key', env: {} }, p)
  const code = await runCli(['refresh', 'api', '--token', 'x'], { platform: 'linux' })
  e2(code).toBe(1)                              // runCli returns 1 on thrown errors
})
```

(`setSec` is the `setSecret` alias already imported in this file's `i2`/`e2` block.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/cli.test.ts -t "refresh"`
Expected: FAIL — unknown command `refresh` → non-zero / error.

- [ ] **Step 3: Implement the command**

In `src/cli.ts`, insert after the `token` command block (after line 272, before the `add` command):

```ts
  program
    .command('refresh <name>')
    .option('--token <token>', 'bearer token to store (else read AWS_BEARER_TOKEN_BEDROCK from the environment)')
    .description('replace a bedrock-key profile\'s token in place and re-derive its expiry')
    .action(async (name: string, opts: { token?: string }) => {
      if (!profileExists(name, p)) throw new Error(`Unknown profile: ${name}. See: ccswitch list`)
      const profile = loadProfile(name, p)
      if (profile.type !== 'bedrock-key') {
        throw new Error(`Profile '${name}' is not a bedrock-key profile; refresh only applies to bedrock-key.`)
      }
      const token = opts.token ?? env.AWS_BEARER_TOKEN_BEDROCK
      if (!token) throw new Error('No token to store. Pass --token <t> or set AWS_BEARER_TOKEN_BEDROCK.')
      await setSecret(name, token, plat, p)
      const exp = deriveBedrockKeyExpiry(token)
      const updated: Profile = { ...profile }
      if (exp) updated.credExpiresAt = exp
      else delete updated.credExpiresAt   // new token isn't short-term → clear stale expiry
      saveProfile(updated, p)
      const badge = exp ? ` (expires ${exp.slice(0, 16).replace('T', ' ')} UTC)` : ''
      process.stdout.write(`Refreshed Bedrock token for '${name}'.${badge}\n`)
    })
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run test/cli.test.ts -t "refresh" && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts test/cli.test.ts
git commit -m "feat: add ccswitch refresh for in-place Bedrock token replacement"
```

---

### Task 4: Surface expiry in `doctor` and `list`

**Files:**
- Modify: `src/doctor.ts:81-90` (per-profile findings), `src/doctor.ts:116-152` (`describeActive`), `src/doctor.ts` imports
- Modify: `src/cli.ts:45-54` (`list` action)
- Test: `test/doctor.test.ts`

**Interfaces:**
- Consumes: `describeBedrockExpiry`, `bedrockExpiryStatus` from `./bedrockExpiry.js`.
- Produces: an `expires:` line in `describeActive` for tracked bedrock-key active profiles; a warn finding for `expiring`/`expired`; an inline `[…]` badge in `list`.

- [ ] **Step 1: Write the failing test (doctor)**

In `test/doctor.test.ts`, use the existing `snap()` builder (fixed `now = 2026-07-10T00:00:00Z`) and `Profile` import. Add:

```ts
it('describeActive shows an expires line for a tracked bedrock-key active profile', () => {
  const profile: Profile = { name: 'brk', type: 'bedrock-key', env: {}, credExpiresAt: '2026-07-10T03:00:00.000Z' }
  const lines = describeActive(snap({
    profiles: [profile],
    active: { name: 'brk', managedKeys: [] },
    profileStates: { brk: { hasSecret: true, hasToken: false, configDirExists: false, secretPreview: 'sk-x' } },
  }))
  expect(lines.some((l) => l.includes('expires:') && l.includes('in 3h'))).toBe(true)
})

it('diagnose warns when a bedrock-key token is expired', () => {
  const profile: Profile = { name: 'brk', type: 'bedrock-key', env: {}, credExpiresAt: '2026-07-09T23:00:00.000Z' }
  const fs = diagnose(snap({
    profiles: [profile],
    profileStates: { brk: { hasSecret: true, hasToken: false, configDirExists: false } },
  }))
  expect(warns(fs).some((f) => /expired/i.test(f.message))).toBe(true)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/doctor.test.ts -t "bedrock-key"`
Expected: FAIL — no `expires:` line, no expiry warn finding.

- [ ] **Step 3: Add imports to `src/doctor.ts`**

Near the existing `import { tokenStaleWarning, tokenAgeDays } from './tokenAge.js'` line at the top of `src/doctor.ts`, add:

```ts
import { describeBedrockExpiry, bedrockExpiryStatus } from './bedrockExpiry.js'
```

- [ ] **Step 4: Add a warn finding for expiring/expired keys**

In `diagnose`, inside the per-profile loop, extend the `bedrock-key` handling. Find the branch at lines 83-90 and add after the `if (!st.hasSecret) {...}` block (still inside the `else if (... 'bedrock-key')`):

```ts
      const bexp = bedrockExpiryStatus(profile, snap.now)
      if (bexp.state === 'expired') {
        findings.push({
          level: 'warn',
          message: `Bedrock profile '${profile.name}' token has expired. Refresh: ccswitch refresh ${profile.name}`,
        })
      } else if (bexp.state === 'expiring') {
        findings.push({
          level: 'warn',
          message: `Bedrock profile '${profile.name}' token expires soon. Refresh: ccswitch refresh ${profile.name}`,
        })
      }
```

- [ ] **Step 5: Add the `expires:` line to `describeActive`**

In `describeActive`, extend the `api-key || bedrock-key` block (lines 128-130) to append an expiry line for bedrock-key:

```ts
  if (profile.type === 'api-key' || profile.type === 'bedrock-key') {
    lines.push(`  credential:  ${st?.secretPreview ? maskSecret(st.secretPreview) : '(missing)'}`)
  }

  if (profile.type === 'bedrock-key') {
    const badge = describeBedrockExpiry(profile, snap.now)
    if (badge) lines.push(`  expires:     ${badge}`)
  }
```

- [ ] **Step 6: Write the failing test (list)**

In `test/cli.test.ts`, add a test asserting `list` prints an expiry badge for a tracked bedrock-key profile (build the profile with a `credExpiresAt` ~3h in the future relative to a controllable clock — note `list` uses `new Date()`, so assert on the state-independent substring `EXPIRED` by giving a past `credExpiresAt` to avoid clock flakiness):

```ts
i2('list shows EXPIRED badge for a bedrock-key profile past its expiry', async () => {
  const p = paths(process.env, 'linux')
  saveProfile({ name: 'brk', type: 'bedrock-key', env: {}, credExpiresAt: '2000-01-01T00:00:00.000Z' }, p)
  const code = await runCli(['list'], { platform: 'linux' })
  e2(code).toBe(0)
  e2(out.join('')).toMatch(/brk \(bedrock-key\).*EXPIRED/)
})
```

- [ ] **Step 7: Update the `list` action in `src/cli.ts`**

Add `describeBedrockExpiry` to the Task 2 import if not already present, then change the `list` action loop (lines 46-50):

```ts
      for (const prof of profiles) {
        const mark = prof.name === active ? '* ' : '  '
        const stale = tokenStaleWarning(prof, now) ? '  [stale token]' : ''
        const exp = describeBedrockExpiry(prof, now)
        const expBadge = exp ? `  [expires ${exp}]` : ''
        process.stdout.write(`${mark}${prof.name} (${prof.type})${stale}${expBadge}\n`)
      }
```

(`describeBedrockExpiry` for the past-expiry case yields `EXPIRED (…)`, so the badge reads `[expires EXPIRED (2h ago)]` — matches the `/EXPIRED/` assertion. Keep the wording; it is unambiguous in context.)

- [ ] **Step 8: Run tests + typecheck**

Run: `npx vitest run test/doctor.test.ts test/cli.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/doctor.ts src/cli.ts test/doctor.test.ts test/cli.test.ts
git commit -m "feat: surface Bedrock token expiry in doctor and list"
```

---

### Task 5: Block expired, warn on expiring, at switch/env time

**Files:**
- Modify: `src/cli.ts` default switch action (after `const profile = loadProfile(target, p)`, ~line 369) and `env` action (lines 105-109)
- Test: `test/cli.test.ts`

**Interfaces:**
- Consumes: `bedrockExpiredMessage`, `bedrockExpiringWarning` from `./bedrockExpiry.js` (imported in Task 2).
- Produces: `ccswitch <name>` and `ccswitch env <name>` **throw** for an `expired` bedrock-key profile, and print a stderr **warning** for an `expiring` one.

- [ ] **Step 1: Write the failing tests**

In `test/cli.test.ts`. To assert the stderr warning, capture `process.stderr.write` the way the existing "unknown profile switch" test (line 55-58) does. A bedrock-key global switch touches settings, so give the profile a stored secret and let `runCli` run to completion:

```ts
i2('blocks a global switch to an expired bedrock-key profile', async () => {
  const p = paths(process.env, 'linux')
  saveProfile({ name: 'brk', type: 'bedrock-key', env: { CLAUDE_CODE_USE_BEDROCK: '1' }, credExpiresAt: '2000-01-01T00:00:00.000Z' }, p)
  await setSec('brk', 'some-token', 'linux', p)
  const code = await runCli(['brk'], { platform: 'linux' })
  e2(code).toBe(1)                         // thrown → runCli returns 1
})

i2('blocks env for an expired bedrock-key profile', async () => {
  const p = paths(process.env, 'linux')
  saveProfile({ name: 'brk', type: 'bedrock-key', env: { CLAUDE_CODE_USE_BEDROCK: '1' }, credExpiresAt: '2000-01-01T00:00:00.000Z' }, p)
  await setSec('brk', 'some-token', 'linux', p)
  const code = await runCli(['env', 'brk'], { platform: 'linux' })
  e2(code).toBe(1)
})

i2('warns (does not block) an env for an expiring bedrock-key profile', async () => {
  const p = paths(process.env, 'linux')
  const soon = new Date(Date.now() + 10 * 60 * 1000).toISOString()   // 10 min out
  saveProfile({ name: 'brk', type: 'bedrock-key', env: { CLAUDE_CODE_USE_BEDROCK: '1' }, credExpiresAt: soon }, p)
  await setSec('brk', 'some-token', 'linux', p)
  const err: string[] = []
  const origErr = process.stderr.write
  process.stderr.write = ((s: string) => { err.push(String(s)); return true }) as any
  try {
    const code = await runCli(['env', 'brk'], { platform: 'linux' })
    e2(code).toBe(0)                       // not blocked
    e2(err.join('')).toMatch(/expires in/)
  } finally {
    process.stderr.write = origErr
  }
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/cli.test.ts -t "bedrock-key profile"`
Expected: FAIL — expired switch/env currently returns 0; no expiring warning printed.

- [ ] **Step 3: Guard the default switch action**

In `src/cli.ts`, in the bare-name switch action, immediately after `const profile = loadProfile(target, p)`:

```ts
      const profile = loadProfile(target, p)
      const expiredMsg = bedrockExpiredMessage(profile, new Date())
      if (expiredMsg) throw new Error(expiredMsg)
      const expiringMsg = bedrockExpiringWarning(profile, new Date())
      if (expiringMsg) process.stderr.write(`Warning: ${expiringMsg}\n`)
```

- [ ] **Step 4: Guard the `env` action**

In the `env` action, after `const profile = loadProfile(name, p)` (line 105) and before reading the secret:

```ts
      const profile = loadProfile(name, p)
      const expiredMsg = bedrockExpiredMessage(profile, new Date())
      if (expiredMsg) throw new Error(expiredMsg)
      const expiringMsg = bedrockExpiringWarning(profile, new Date())
      if (expiringMsg) process.stderr.write(`Warning: ${expiringMsg}\n`)
      const secret = await getSecret(name, plat, p, { slot: profile.type === 'login' ? 'token' : 'secret' })
```

- [ ] **Step 5: Run tests + full suite + typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: PASS (full suite green — this confirms untracked/fresh profiles are unaffected).

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts test/cli.test.ts
git commit -m "feat: block expired and warn on expiring Bedrock-key at switch/env"
```

---

### Task 6: Opt-in SigV4 liveness probe (`bedrock` type, `--check`)

**Files:**
- Modify: `src/cli.ts` default switch action (add `--check` option to the bare-name command; run probe for `type: 'bedrock'`)
- Modify: `src/exec.ts` — reuse existing `run(cmd, args)`; no change expected (verify signature)
- Test: `test/cli.test.ts`

**Interfaces:**
- Consumes: `run` from `./exec.js` (existing `run(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }>` — confirm exact shape in `src/exec.ts` before use).
- Produces: `ccswitch <name> --check` runs `aws sts get-caller-identity --profile <AWS_PROFILE>` for a `bedrock` profile and warns (never blocks) on failure. Off by default.

- [ ] **Step 1: Confirm the `run` signature**

Read `src/exec.ts` and confirm the exported `run` function's exact signature and return shape. Use it as-is; do not add a dependency. If `run` throws rather than returning a non-zero `code`, wrap the call in try/catch in Step 3.

- [ ] **Step 2: Write the failing test**

The bare-name action calls `globalSwitch` with real deps, so this test injects a fake `aws` outcome by asserting behavior at the seam you add. Add a `--check` code path that is testable: extract the probe into a small helper you can unit-test directly rather than shelling out in the test.

Add to `src/bedrockExpiry.ts` a pure formatter (keeps `cli.ts` thin and testable):

```ts
// Warning text for a failed SigV4 liveness probe, or null when it passed.
export function bedrockLivenessWarning(awsProfile: string, exitCode: number): string | null {
  if (exitCode === 0) return null
  return `Bedrock SigV4 credentials for AWS_PROFILE='${awsProfile}' failed a liveness check ` +
    `(aws sts get-caller-identity exited ${exitCode}). They may be expired — run your AWS login (e.g. aws sso login).`
}
```

Test in `test/bedrockExpiry.test.ts`:

```ts
import { bedrockLivenessWarning } from '../src/bedrockExpiry.js'

describe('bedrockLivenessWarning', () => {
  it('is null on success', () => {
    expect(bedrockLivenessWarning('dev', 0)).toBeNull()
  })
  it('warns on failure, naming the profile', () => {
    const w = bedrockLivenessWarning('dev', 255)
    expect(w).toContain("AWS_PROFILE='dev'")
    expect(w).toContain('liveness check')
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run test/bedrockExpiry.test.ts -t "bedrockLivenessWarning"`
Expected: FAIL — `bedrockLivenessWarning` not exported.

- [ ] **Step 4: Implement the formatter and wire `--check`**

Add `bedrockLivenessWarning` to `src/bedrockExpiry.ts` (per Step 2). In `src/cli.ts`, add the option and import, and run the probe in the bare-name action:

Add `run` to imports: `import { runInteractive } from './exec.js'` already exists — extend to `import { runInteractive, run } from './exec.js'` (verify `run` is exported; adjust name to the actual export from Step 1). Add `bedrockLivenessWarning` to the `./bedrockExpiry.js` import.

Change the command definition:

```ts
  program
    .argument('[name]', 'profile to switch to globally')
    .option('--check', 'for a bedrock (SigV4) profile, probe credential validity via aws sts get-caller-identity')
    .action(async (name: string | undefined, opts: { check?: boolean }) => {
```

After the successful `globalSwitch(...)` call and its stdout message, add:

```ts
      if (opts.check && profile.type === 'bedrock') {
        const awsProfile = profile.env.AWS_PROFILE ?? ''
        try {
          const r = await run('aws', ['sts', 'get-caller-identity', '--profile', awsProfile])
          const w = bedrockLivenessWarning(awsProfile, r.code)
          if (w) process.stderr.write(`\nWarning: ${w}\n`)
        } catch (err: any) {
          process.stderr.write(`\nWarning: liveness check could not run (${err?.message ?? err}). Is the AWS CLI installed?\n`)
        }
      }
```

(Adjust `r.code` to the real field name confirmed in Step 1.)

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts src/bedrockExpiry.ts test/bedrockExpiry.test.ts
git commit -m "feat: opt-in SigV4 liveness probe for bedrock profiles (--check)"
```

---

### Task 7: Documentation

**Files:**
- Modify: `README.md` (Commands table; new "Short-lived Bedrock tokens" section; `doctor`/`list` notes)
- Modify: `src/cli.ts` `help` command (lines 65-95) — add `refresh` line and an expiry note

**Interfaces:** none (docs only).

- [ ] **Step 1: Update the `help` command text**

In `src/cli.ts`, in the `help` action's Common commands list, add after the `ccswitch token` line:

```ts
          '  ccswitch refresh <name>    replace a bedrock-key token in place (re-derives expiry)',
```

And in the `bedrock-key` auth-type description, append a sentence:

```ts
          '               Short-term keys expire; ccswitch tracks expiry and blocks switching',
          '               to an expired one. Refresh with: ccswitch refresh <name>.',
```

- [ ] **Step 2: Update `README.md` Commands block**

In the Commands code block, add a line under `ccswitch token`:

```
ccswitch refresh <name>     replace a bedrock-key profile's bearer token in
                            place and re-derive its expiry (reads --token or
                            $AWS_BEARER_TOKEN_BEDROCK)
```

- [ ] **Step 3: Add a "Short-lived Bedrock tokens" section to `README.md`**

Add after the existing "Bedrock API keys (`bedrock-key`)" section:

```markdown
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

​```bash
ccswitch my-bedrock-profile --check
​```
```

- [ ] **Step 4: Verify build + full suite**

Run: `npm run build && npx vitest run && npm run typecheck`
Expected: build succeeds, all tests pass, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add README.md src/cli.ts
git commit -m "docs: document short-lived Bedrock token handling and refresh"
```

---

## Notes for the implementer

- The `test/cli.test.ts` harness details (temp `paths`, env injection, stdout capture, `platform` value) are established by existing tests in that file — copy their exact setup rather than inventing new helpers. The plan's test snippets show intent and assertions; wire them to the existing harness.
- `runCli` returns `0` on success and `1` when an action throws (see `src/cli.ts` catch block at the end). Tests assert on that return code for blocking behavior.
- Keep all expiry logic in `src/bedrockExpiry.ts`. `cli.ts` and `doctor.ts` should only call its functions and format output — no expiry math outside the module.
