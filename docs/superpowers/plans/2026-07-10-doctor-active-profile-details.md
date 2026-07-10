# Doctor Active-Profile Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `ccswitch doctor` print an "Active profile details" block showing the active profile's identity (email/org), auth type, config dir, masked credential preview, and OAuth token age.

**Architecture:** Two new pure functions in `src/doctor.ts` — `maskSecret()` and `describeActive()` — driven entirely off the existing `DoctorSnapshot`, mirroring the pure/testable pattern of `diagnose()`. `ProfileState` gains an optional `secretPreview` field the CLI populates for the active api-key/bedrock-key profile. The `doctor` CLI action calls `describeActive()` and prints its lines after the findings.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest, Commander.

## Global Constraints

- ESM imports use `.js` specifiers (e.g. `from './tokenAge.js'`).
- `diagnose()` and the new functions stay **pure** — no I/O, all state via the snapshot.
- Never print a full secret. Masking rule is `maskSecret` below, no exceptions.
- Account fields read defensively from `oauthAccount` (typed `unknown`).
- Match existing test style in `test/doctor.test.ts` (the `snap()` helper, `now` constant).

---

### Task 1: `maskSecret` helper

**Files:**
- Modify: `src/doctor.ts` (add exported function)
- Test: `test/doctor.test.ts` (add `describe('maskSecret')`)

**Interfaces:**
- Produces: `export function maskSecret(value: string | null | undefined): string`

- [ ] **Step 1: Write the failing tests**

Add to `test/doctor.test.ts`. Update the top import to include `maskSecret`:

```typescript
import { diagnose, maskSecret, type DoctorSnapshot, type Finding } from '../src/doctor.js'
```

Then append:

```typescript
describe('maskSecret', () => {
  it('shows first 6 and last 4 with length for long secrets', () => {
    expect(maskSecret('sk-ant-api03-abcdefghij-a3f9')).toBe('sk-ant…a3f9 (len 28)')
  })
  it('shows only last 4 with length for short secrets', () => {
    expect(maskSecret('abcdef')).toBe('…cdef (len 6)')
  })
  it('returns (none) for empty string', () => {
    expect(maskSecret('')).toBe('(none)')
  })
  it('returns (none) for null or undefined', () => {
    expect(maskSecret(null)).toBe('(none)')
    expect(maskSecret(undefined)).toBe('(none)')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/doctor.test.ts -t maskSecret`
Expected: FAIL — `maskSecret is not a function` / not exported.

- [ ] **Step 3: Implement `maskSecret`**

Add to `src/doctor.ts` (after the imports, before `diagnose`):

```typescript
// Mask a stored secret for display: never reveal the full value. Long secrets
// show first-6 + last-4; short ones show only last-4 to avoid over-exposure.
export function maskSecret(value: string | null | undefined): string {
  if (!value) return '(none)'
  const len = value.length
  if (len >= 12) return `${value.slice(0, 6)}…${value.slice(-4)} (len ${len})`
  return `…${value.slice(-4)} (len ${len})`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/doctor.test.ts -t maskSecret`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/doctor.ts test/doctor.test.ts
git commit -m "feat: add maskSecret helper for doctor credential preview"
```

---

### Task 2: `secretPreview` field on `ProfileState`

**Files:**
- Modify: `src/doctor.ts` (`ProfileState` interface)

**Interfaces:**
- Produces: `ProfileState` now has optional `secretPreview?: string`.

- [ ] **Step 1: Add the field**

In `src/doctor.ts`, extend the `ProfileState` interface:

```typescript
export interface ProfileState {
  hasSecret: boolean
  hasToken: boolean
  configDirExists: boolean
  // Raw stored secret value for the active api-key/bedrock-key profile only,
  // captured by the CLI so describeActive() can render a masked preview.
  // Unset for all other profiles.
  secretPreview?: string
}
```

- [ ] **Step 2: Verify the type compiles**

Run: `npx tsc --noEmit`
Expected: PASS (no errors — optional field is backward compatible).

- [ ] **Step 3: Commit**

```bash
git add src/doctor.ts
git commit -m "feat: add optional secretPreview to ProfileState"
```

---

### Task 3: `describeActive` — no active profile & bedrock

**Files:**
- Modify: `src/doctor.ts` (add exported function)
- Test: `test/doctor.test.ts` (add `describe('describeActive')`)

**Interfaces:**
- Consumes: `DoctorSnapshot`, `maskSecret` (Task 1), `ProfileState.secretPreview` (Task 2), `tokenAgeDays` from `./tokenAge.js`.
- Produces: `export function describeActive(snap: DoctorSnapshot): string[]`

- [ ] **Step 1: Write the failing tests**

Update the import in `test/doctor.test.ts` to add `describeActive`:

```typescript
import { diagnose, maskSecret, describeActive, type DoctorSnapshot, type Finding } from '../src/doctor.js'
```

Append:

```typescript
describe('describeActive', () => {
  it('returns a single line when there is no active profile', () => {
    expect(describeActive(snap())).toEqual(['No active profile.'])
  })

  it('describes a bedrock profile with name, type and default config dir', () => {
    const profile: Profile = { name: 'br', type: 'bedrock', env: { CLAUDE_CODE_USE_BEDROCK: '1' } }
    const lines = describeActive(snap({
      profiles: [profile],
      active: { name: 'br', managedKeys: [] },
      profileStates: { br: { hasSecret: false, hasToken: false, configDirExists: false } },
    }))
    expect(lines[0]).toBe('Active profile details:')
    expect(lines.join('\n')).toContain('name:        br')
    expect(lines.join('\n')).toContain('type:        bedrock')
    expect(lines.join('\n')).toContain('config dir:  (default)')
    expect(lines.join('\n')).not.toContain('credential:')
    expect(lines.join('\n')).not.toContain('account:')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/doctor.test.ts -t describeActive`
Expected: FAIL — `describeActive is not a function`.

- [ ] **Step 3: Implement the base of `describeActive`**

Add to `src/doctor.ts` (after `diagnose`). This version handles no-active, header, and the common name/type/config-dir lines; type-specific lines are added in Task 4:

```typescript
// Human-readable details for the active profile only. Pure: reads everything
// from the snapshot. Returns display lines (no icons). diagnose() reports drift;
// this shows identity — who/what you are actually running as.
export function describeActive(snap: DoctorSnapshot): string[] {
  if (snap.active === null) return ['No active profile.']
  const profile = snap.profiles.find((p) => p.name === snap.active!.name)
  if (!profile) return ['No active profile.']

  const st = snap.profileStates[profile.name]
  const lines: string[] = ['Active profile details:']
  lines.push(`  name:        ${profile.name}`)
  lines.push(`  type:        ${profile.type}`)
  lines.push(`  config dir:  ${profile.configDir ?? '(default)'}`)

  if (profile.type === 'api-key' || profile.type === 'bedrock-key') {
    lines.push(`  credential:  ${st?.secretPreview ? maskSecret(st.secretPreview) : '(missing)'}`)
  }

  return lines
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/doctor.test.ts -t describeActive`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/doctor.ts test/doctor.test.ts
git commit -m "feat: add describeActive base (header, name, type, config dir)"
```

---

### Task 4: `describeActive` — credential, account & token lines

**Files:**
- Modify: `src/doctor.ts` (`describeActive` + a small account helper)
- Test: `test/doctor.test.ts` (extend `describe('describeActive')`)

**Interfaces:**
- Consumes: `tokenAgeDays` from `./tokenAge.js`, `Profile.oauthAccount`, `Profile.tokenCapturedAt`, `Profile.hasToken`.
- Produces: `describeActive` now emits `credential:` (key types), `account:` and `token:` (login type).

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('describeActive')` block:

```typescript
  it('shows a masked credential for an active api-key profile', () => {
    const profile: Profile = { name: 'k', type: 'api-key', env: {} }
    const lines = describeActive(snap({
      profiles: [profile],
      active: { name: 'k', managedKeys: ['apiKeyHelper'] },
      profileStates: { k: { hasSecret: true, hasToken: false, configDirExists: false, secretPreview: 'sk-ant-api03-xyz-a3f9' } },
    }))
    expect(lines.join('\n')).toContain('credential:  sk-ant…a3f9 (len 21)')
    expect(lines.join('\n')).not.toContain('account:')
  })

  it('shows (missing) credential when the active key profile has no secretPreview', () => {
    const profile: Profile = { name: 'bk', type: 'bedrock-key', env: {} }
    const lines = describeActive(snap({
      profiles: [profile],
      active: { name: 'bk', managedKeys: [] },
      profileStates: { bk: { hasSecret: false, hasToken: false, configDirExists: false } },
    }))
    expect(lines.join('\n')).toContain('credential:  (missing)')
  })

  it('shows account (email and org) and token age for a login profile', () => {
    const captured = new Date(now.getTime() - 12 * 24 * 60 * 60 * 1000).toISOString()
    const profile: Profile = {
      name: 'work', type: 'login', env: {}, hasToken: true, tokenCapturedAt: captured,
      oauthAccount: { emailAddress: 'olayemii@example.com', organizationName: 'Acme Inc' },
    }
    const lines = describeActive(snap({
      profiles: [profile],
      active: { name: 'work', managedKeys: [] },
      profileStates: { work: { hasSecret: true, hasToken: true, configDirExists: false } },
    }))
    expect(lines.join('\n')).toContain('account:     olayemii@example.com — Acme Inc')
    expect(lines.join('\n')).toContain('token:       captured 12 days ago')
    expect(lines.join('\n')).toContain('(' + captured.slice(0, 10) + ')')
    expect(lines.join('\n')).not.toContain('credential:')
  })

  it('shows email alone when the login profile oauthAccount has no org', () => {
    const profile: Profile = {
      name: 'work', type: 'login', env: {},
      oauthAccount: { emailAddress: 'solo@example.com' },
    }
    const lines = describeActive(snap({
      profiles: [profile],
      active: { name: 'work', managedKeys: [] },
      profileStates: { work: { hasSecret: true, hasToken: false, configDirExists: false } },
    }))
    expect(lines.join('\n')).toContain('account:     solo@example.com')
    expect(lines.join('\n')).not.toContain('—')
  })

  it('omits the account line when a login profile has no oauthAccount', () => {
    const profile: Profile = { name: 'work', type: 'login', env: {} }
    const lines = describeActive(snap({
      profiles: [profile],
      active: { name: 'work', managedKeys: [] },
      profileStates: { work: { hasSecret: true, hasToken: false, configDirExists: false } },
    }))
    expect(lines.join('\n')).not.toContain('account:')
    expect(lines.join('\n')).toContain('token:       none captured')
  })

  it('shows unknown capture date when a login token has no tokenCapturedAt', () => {
    const profile: Profile = { name: 'work', type: 'login', env: {}, hasToken: true }
    const lines = describeActive(snap({
      profiles: [profile],
      active: { name: 'work', managedKeys: [] },
      profileStates: { work: { hasSecret: true, hasToken: true, configDirExists: false } },
    }))
    expect(lines.join('\n')).toContain('token:       present, capture date unknown')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/doctor.test.ts -t describeActive`
Expected: FAIL — account/token lines missing.

- [ ] **Step 3: Implement the account helper and login lines**

In `src/doctor.ts`, ensure the `tokenAgeDays` import is present at the top:

```typescript
import { tokenStaleWarning, tokenAgeDays } from './tokenAge.js'
```

Add a helper above `describeActive`:

```typescript
// Read email/org defensively from the cached oauthAccount (typed unknown).
// Returns a display string like "email — org", "email", or null when absent.
function formatAccount(account: unknown): string | null {
  if (account == null || typeof account !== 'object') return null
  const email = (account as Record<string, unknown>).emailAddress
  if (typeof email !== 'string' || email === '') return null
  const org = (account as Record<string, unknown>).organizationName
  return typeof org === 'string' && org !== '' ? `${email} — ${org}` : email
}
```

Then extend `describeActive` — replace its `return lines` tail so the login branch is handled before returning:

```typescript
  if (profile.type === 'login') {
    const account = formatAccount(profile.oauthAccount)
    if (account) lines.push(`  account:     ${account}`)

    if (!profile.hasToken) {
      lines.push('  token:       none captured')
    } else if (!profile.tokenCapturedAt) {
      lines.push('  token:       present, capture date unknown')
    } else {
      const age = tokenAgeDays(profile, snap.now)
      const date = profile.tokenCapturedAt.slice(0, 10)
      lines.push(`  token:       captured ${age} days ago (${date})`)
    }
  }

  return lines
```

Note: the `api-key`/`bedrock-key` credential branch from Task 3 stays as-is above this block.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/doctor.test.ts`
Expected: PASS (all doctor tests, including diagnose, maskSecret, describeActive).

- [ ] **Step 5: Commit**

```bash
git add src/doctor.ts test/doctor.test.ts
git commit -m "feat: add account and token detail lines to describeActive"
```

---

### Task 5: Wire `describeActive` and `secretPreview` into the CLI

**Files:**
- Modify: `src/cli.ts` (`doctor` action, ~lines 163-189)
- Test: `test/cli.test.ts` (add a doctor output assertion if the file has a harness for it; otherwise verify manually per Step 4)

**Interfaces:**
- Consumes: `describeActive` (Tasks 3-4), `ProfileState.secretPreview` (Task 2).

- [ ] **Step 1: Update the doctor import**

In `src/cli.ts` line 21, add `describeActive`:

```typescript
import { diagnose, describeActive, type DoctorSnapshot, type ProfileState } from './doctor.js'
```

- [ ] **Step 2: Capture secretPreview for the active key profile**

In the `doctor` action, replace the `profileStates` build loop (lines ~165-173) so the active api-key/bedrock-key profile's secret value is captured:

```typescript
      const activeName = readActive(p)?.name
      const profiles = listProfiles(p)
      const profileStates: Record<string, ProfileState> = {}
      for (const prof of profiles) {
        const secretSlot = prof.type === 'bedrock' ? null : 'secret'
        const secret = secretSlot === null ? null : await getSecret(prof.name, plat, p)
        const isActiveKey = prof.name === activeName && (prof.type === 'api-key' || prof.type === 'bedrock-key')
        profileStates[prof.name] = {
          hasSecret: secret !== null,
          hasToken: prof.type === 'login' ? (await getSecret(prof.name, plat, p, { slot: 'token' })) !== null : false,
          configDirExists: prof.configDir ? existsSync(prof.configDir) : false,
          ...(isActiveKey && secret !== null ? { secretPreview: secret } : {}),
        }
      }
```

Then reuse the same value for the snapshot: change the snapshot's `active: readActive(p),` line to `active: readActive(p),` → capture once. Concretely, declare `const active = readActive(p)` at the top of the action, set `const activeName = active?.name`, and use `active` in the snapshot's `active:` field — a single read, no duplication.

- [ ] **Step 3: Print the details block**

After the findings-printing loop and before the summary (line ~184-187), insert the details block:

```typescript
      const findings = diagnose(snap)
      const icon = { ok: '✓', warn: '!', error: '✗' } as const
      for (const f of findings) process.stdout.write(`${icon[f.level]} ${f.message}\n`)

      process.stdout.write('\n')
      for (const line of describeActive(snap)) process.stdout.write(`${line}\n`)

      const errors = findings.filter((f) => f.level === 'error').length
      const warnCount = findings.filter((f) => f.level === 'warn').length
      process.stdout.write(`\n${errors} error(s), ${warnCount} warning(s).\n`)
      if (errors > 0) throw new Error('doctor found problems')
```

- [ ] **Step 4: Verify the build, type-check and full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS — no type errors, all tests green.

- [ ] **Step 5: Manually exercise doctor**

Run: `npx tsx src/cli.ts doctor` (or the project's build+run equivalent)
Expected: findings print as before, followed by an `Active profile details:` block (or `No active profile.`), then the summary. Confirm no full secret appears.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts
git commit -m "feat: show active-profile details block in ccswitch doctor"
```

---

### Task 6: README documentation

**Files:**
- Modify: `README.md` (doctor section)

- [ ] **Step 1: Locate the doctor docs**

Run: `grep -n "doctor" README.md`
Expected: at least one line describing the `doctor` command.

- [ ] **Step 2: Add a short description + sample output**

Under the doctor command's documentation, add a note that doctor now prints an "Active profile details" block (auth type, config dir, masked credential, account email/org, token age) and that secrets are always masked (first 6 + last 4 chars). Include a fenced sample matching the spec:

```
Active profile details:
  name:        work
  type:        bedrock-key
  config dir:  (default)
  credential:  sk-ant…a3f9 (len 108)
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document active-profile details in doctor output"
```

---

## Self-Review

- **Spec coverage:** login/api-key/bedrock-key/bedrock branches (Tasks 3-4), masking rule with short-secret guard (Task 1), account email-only + missing cases (Task 4), token age/unknown/none (Task 4), no-active line (Task 3), CLI wiring + secretPreview capture (Tasks 2, 5), README (Task 6). All spec sections covered.
- **Placeholder scan:** none — every code step shows full code.
- **Type consistency:** `describeActive(snap): string[]`, `maskSecret(value): string`, `ProfileState.secretPreview?: string`, and `formatAccount(account: unknown): string | null` are used consistently across tasks; `tokenAgeDays` imported from `./tokenAge.js` matches the existing signature.
