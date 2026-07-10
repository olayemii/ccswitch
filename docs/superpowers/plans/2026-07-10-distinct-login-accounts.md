# Distinct login-account capture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user keep multiple distinct `login` (OAuth) profiles by capturing a fresh account per profile and warning when a capture is a byte-identical duplicate of an existing one.

**Architecture:** The storage layer is already name-scoped, so the change is confined to the capture step. Add a pure credential-fingerprint helper (SHA-256 hex) and a pure duplicate-finder over profiles. Wire both into the `save` command (non-interactive, `--force` override) and the `add` command (interactive, guided re-login prompt + confirm override). No changes to switching, per-shell tokens, or the api-key/bedrock/bedrock-key flows.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Node built-ins (`node:crypto`), commander, @clack/prompts, vitest.

## Global Constraints

- ESM project: all intra-repo imports use the `.js` extension (e.g. `./fingerprint.js`).
- The raw credential is NEVER written into a profile JSON file — only its SHA-256 hex hash (`credHash`).
- The duplicate guard applies to `login` profiles only.
- Existing profiles without `credHash` must never trigger a false duplicate match.
- Follow existing test style: inject `platform: 'linux'` / `env` into `runCli`; write fixtures under a temp `HOME`.
- Commit messages follow this repo's conventional-commit style (`feat:`, `fix:`, `test:`).

---

### Task 1: Credential fingerprint + duplicate finder

**Files:**
- Create: `src/fingerprint.ts`
- Modify: `src/types.ts:4-10` (add `credHash?` to `Profile`)
- Test: `test/fingerprint.test.ts`

**Interfaces:**
- Consumes: `Profile` from `./types.js`.
- Produces:
  - `hashCredential(value: string): string` — SHA-256 hex digest.
  - `findDuplicateLoginName(credHash: string, profiles: Profile[], excludeName: string): string | null` — returns the `name` of the first `login` profile (other than `excludeName`) whose `credHash` equals the argument, else `null`.

- [ ] **Step 1: Write the failing test**

```ts
// test/fingerprint.test.ts
import { describe, it, expect } from 'vitest'
import { hashCredential, findDuplicateLoginName } from '../src/fingerprint.js'
import type { Profile } from '../src/types.js'

describe('hashCredential', () => {
  it('is stable and hex-encoded for the same input', () => {
    const a = hashCredential('the-credential-blob')
    const b = hashCredential('the-credential-blob')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('differs for different inputs', () => {
    expect(hashCredential('acct-a')).not.toBe(hashCredential('acct-b'))
  })
})

describe('findDuplicateLoginName', () => {
  const login = (name: string, credHash?: string): Profile => ({ name, type: 'login', env: {}, credHash })

  it('finds another login profile with the same hash', () => {
    const h = hashCredential('same')
    const profiles = [login('personal', h), login('work', hashCredential('other'))]
    expect(findDuplicateLoginName(h, profiles, 'newone')).toBe('personal')
  })

  it('excludes the profile being (re)saved', () => {
    const h = hashCredential('same')
    const profiles = [login('personal', h)]
    expect(findDuplicateLoginName(h, profiles, 'personal')).toBeNull()
  })

  it('ignores non-login profiles and profiles without credHash', () => {
    const h = hashCredential('same')
    const profiles: Profile[] = [
      { name: 'legacy', type: 'login', env: {} },
      { name: 'apikey', type: 'api-key', env: {}, credHash: h } as Profile,
    ]
    expect(findDuplicateLoginName(h, profiles, 'newone')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/fingerprint.test.ts`
Expected: FAIL — cannot resolve `../src/fingerprint.js` / exports not defined.

- [ ] **Step 3: Add `credHash` to the Profile type**

In `src/types.ts`, extend the `Profile` interface:

```ts
export interface Profile {
  name: string
  type: AuthType
  env: Record<string, string>
  configDir?: string
  hasToken?: boolean
  credHash?: string
}
```

- [ ] **Step 4: Write minimal implementation**

```ts
// src/fingerprint.ts
import { createHash } from 'node:crypto'
import type { Profile } from './types.js'

export function hashCredential(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function findDuplicateLoginName(
  credHash: string,
  profiles: Profile[],
  excludeName: string,
): string | null {
  for (const prof of profiles) {
    if (prof.type !== 'login') continue
    if (prof.name === excludeName) continue
    if (prof.credHash && prof.credHash === credHash) return prof.name
  }
  return null
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/fingerprint.test.ts`
Expected: PASS (5 assertions across 5 tests).

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/fingerprint.ts src/types.ts test/fingerprint.test.ts
git commit -m "feat: add credential fingerprint and duplicate-login finder"
```

---

### Task 2: Wire the guard into `save` (login)

**Files:**
- Modify: `src/cli.ts:126-160` (the `save` command action)
- Test: `test/cli.test.ts` (append cases to the `cli save/token` block)

**Interfaces:**
- Consumes: `hashCredential`, `findDuplicateLoginName` from `./fingerprint.js`; `listProfiles` from `./profiles.js` (already imported).
- Produces: `save --type login` now records `profile.credHash` and rejects a duplicate capture unless `--force` is passed.

- [ ] **Step 1: Write the failing tests**

Append to the `cli save/token` describe block in `test/cli.test.ts`:

```ts
i2('save login stores the credential hash on the profile', async () => {
  const p = paths(process.env, 'linux')
  mkdirSync(dirname(p.credentialsFile), { recursive: true })
  writeFileSync(p.credentialsFile, 'live-cred-blob')
  const code = await runCli(['save', 'personal', '--type', 'login'], { platform: 'linux' })
  e2(code).toBe(0)
  const { hashCredential } = await import('../src/fingerprint.js')
  e2(loadProf('personal', p).credHash).toBe(hashCredential('live-cred-blob'))
})

i2('save login rejects a duplicate credential without --force', async () => {
  const p = paths(process.env, 'linux')
  mkdirSync(dirname(p.credentialsFile), { recursive: true })
  writeFileSync(p.credentialsFile, 'live-cred-blob')
  await runCli(['save', 'personal', '--type', 'login'], { platform: 'linux' })

  const err: string[] = []
  const origErrWrite = process.stderr.write
  process.stderr.write = ((s: string) => { err.push(String(s)); return true }) as any
  try {
    const code = await runCli(['save', 'work', '--type', 'login'], { platform: 'linux' })
    e2(code).toBe(1)
    e2(err.join('')).toContain('personal')
  } finally {
    process.stderr.write = origErrWrite
  }
})

i2('save login allows a duplicate credential with --force', async () => {
  const p = paths(process.env, 'linux')
  mkdirSync(dirname(p.credentialsFile), { recursive: true })
  writeFileSync(p.credentialsFile, 'live-cred-blob')
  await runCli(['save', 'personal', '--type', 'login'], { platform: 'linux' })
  const code = await runCli(['save', 'work', '--type', 'login', '--force'], { platform: 'linux' })
  e2(code).toBe(0)
  e2(loadProf('work', p).type).toBe('login')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/cli.test.ts`
Expected: FAIL — `credHash` is `undefined`; the duplicate `save` returns 0 instead of 1.

- [ ] **Step 3: Implement in the `save` login branch**

In `src/cli.ts`, add the import near the other imports:

```ts
import { hashCredential, findDuplicateLoginName } from './fingerprint.js'
```

Replace the `if (opts.type === 'login') { ... }` branch inside the `save` action (currently lines 136-139) with:

```ts
if (opts.type === 'login') {
  const cred = await readLiveCredential(plat, p)
  if (!cred) throw new Error('No live login found. Run /login in Claude Code first.')
  const credHash = hashCredential(cred)
  const dup = findDuplicateLoginName(credHash, listProfiles(p), name)
  if (dup && !opts.force) {
    throw new Error(
      `This credential is identical to profile '${dup}' — you probably didn't log in as a different account. ` +
      `Log in as the intended account first, or re-run with --force.`,
    )
  }
  await setSecret(name, cred, plat, p)
  profile.credHash = credHash
}
```

Note: `profile` is declared just above as `const profile: Profile = { name, type: opts.type, env: {} }`; assigning `profile.credHash` mutates that object before `saveProfile(profile, p)` runs at the end of the action.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/cli.test.ts`
Expected: PASS — including the three new cases.

- [ ] **Step 5: Typecheck, full test run, commit**

```bash
npm run typecheck
npm test
git add src/cli.ts test/cli.test.ts
git commit -m "feat: record credHash and guard duplicate login captures in save"
```

---

### Task 3: Guided re-login + duplicate confirm in `add` (login)

**Files:**
- Modify: `src/cli.ts:206-220` (the `else` login branch of the `add` action)
- Test: manual verification (the `add` flow is interactive via @clack/prompts and is not covered by the existing automated suite).

**Interfaces:**
- Consumes: `hashCredential`, `findDuplicateLoginName` from `./fingerprint.js` (imported in Task 2); `listProfiles` (already imported); `clack` (already imported).
- Produces: `add` for a `login` profile prompts the user to authenticate as the target account, then snapshots and records `credHash`, warning on a byte-identical duplicate.

- [ ] **Step 1: Implement the guided-capture branch**

In `src/cli.ts`, replace the final `else { ... }` login branch of the `add` action (currently lines 210-220, beginning `} else {` and ending before the isolate prompt) with:

```ts
} else {
  const ready = await clack.confirm({
    message: `Log in as the account for '${name}' in Claude Code (run /login as that account), then confirm to capture.`,
    initialValue: true,
  })
  if (clack.isCancel(ready) || ready !== true) return
  const cred = await readLiveCredential(plat, p)
  if (!cred) throw new Error('No live login found. Run /login first, then re-run add.')
  const credHash = hashCredential(cred)
  const dup = findDuplicateLoginName(credHash, listProfiles(p), name)
  if (dup) {
    const proceed = await clack.confirm({
      message: `This credential is identical to profile '${dup}' — you probably didn't log in as a different account. Store it anyway?`,
      initialValue: false,
    })
    if (clack.isCancel(proceed) || proceed !== true) return
  }
  await setSecret(name, cred, plat, p)
  profile.credHash = credHash
  const wantToken = await clack.confirm({ message: 'Capture OAuth token for per-shell use?', initialValue: false })
  if (wantToken === true) {
    const token = await captureOAuthToken()
    await setSecret(name, token, plat, p, { slot: 'token' })
    profile.hasToken = true
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Run the full automated suite (regression check)**

Run: `npm test`
Expected: PASS — no existing test broken (the `add` flow itself is not automated).

- [ ] **Step 4: Manual verification**

Build and exercise the real flow (documents the behavior a reviewer should confirm):

```bash
npm run build
# In Claude Code, /login as account A.
node dist/bin.js add            # name: personal, type: Subscription login → confirm capture
# In Claude Code, /login as account B.
node dist/bin.js add            # name: work, type: login → confirm capture (no duplicate warning)
# Repeat 'work' WITHOUT re-login → expect the "identical to 'work'" warning.
node dist/bin.js list           # shows personal + work
```

Expected: distinct accounts captured; duplicate warning appears only when the live credential was not changed between captures.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts
git commit -m "feat: guided re-login capture with duplicate warning in add"
```

---

## Self-Review

**Spec coverage:**
- Design §1 (guided re-login on capture) → Task 3 (`add`) + Task 2 (`save` reads live, no passive assumption).
- Design §2 (duplicate-credential guard, `credHash`, warn + override) → Task 1 (hash + finder), Task 2 (`save` + `--force`), Task 3 (`add` + confirm).
- Design §3 (unchanged storage/per-shell/api-key/bedrock) → no tasks touch them; Task 2/3 regression runs (`npm test`) confirm.
- Data-model change (`credHash?` on `Profile`) → Task 1 Step 3.

**Placeholder scan:** none — every code step shows complete code; the only non-automated step (Task 3 manual verification) lists exact commands and expected observations, justified because `add` is interactive.

**Type consistency:** `hashCredential(value: string): string` and `findDuplicateLoginName(credHash, profiles, excludeName): string | null` are used with matching signatures in Tasks 2 and 3. `profile.credHash` matches the `credHash?: string` field added in Task 1.
