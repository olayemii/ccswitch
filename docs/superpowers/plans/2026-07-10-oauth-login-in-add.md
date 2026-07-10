# OAuth login in `add` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `ccswitch add` drive `claude auth login` itself for `login`-type profiles, capture the resulting credential, then restore the machine's previously-active login.

**Architecture:** A new interactive spawner (`runInteractive` in `exec.ts`) and a status reader (`readAuthStatus` in `credentials.ts`) feed a small, dependency-injected orchestrator (`captureLogin` in a new `loginCapture.ts`). The orchestrator snapshots the live credential, runs the login, confirms it, captures the credential, and restores the snapshot in a `finally`. `cli.ts`'s `add` login branch becomes a thin caller that supplies real deps plus clack prompts.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Node `child_process`, vitest, `@clack/prompts`, commander.

## Global Constraints

- ESM imports MUST use `.js` extensions (e.g. `from './exec.js'`).
- Process spawning lives in `exec.ts`; other modules receive it via injectable `deps` (matches existing `run` DI pattern in `credentials.ts`/`helpers.ts`/`switch.ts`).
- Live credential slot is keychain service `Claude Code-credentials` (darwin) or `paths.credentialsFile` — accessed only through `readLiveCredential`/`writeLiveCredential`/`neutralizeLiveCredential` (`credentials.ts`).
- `claude auth login` is run with NO flags. Success is confirmed by `claude auth status --json` → `loggedIn === true`.
- The previously-active live credential MUST be restored on every exit path (`finally`); if there was none, the live slot is neutralized.
- Pure helpers `hashCredential` / `findDuplicateLoginName` (`fingerprint.ts`) keep their current signatures.
- `Profile` fields used: `credHash?: string`, `hasToken?: boolean` (`types.ts:9-10`).

---

### Task 1: `runInteractive` in `exec.ts`

**Files:**
- Modify: `src/exec.ts`
- Test: `test/exec.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `runInteractive(cmd: string, args: string[], deps?: { spawn?: typeof import('node:child_process').spawn }): Promise<{ code: number }>` — spawns with `stdio: 'inherit'`, resolves with the child's exit code (`0` if `null`).

- [ ] **Step 1: Write the failing test**

Add to `test/exec.test.ts`:

```typescript
import { runInteractive } from '../src/exec.js'

describe('runInteractive', () => {
  it('inherits stdio and resolves with exit code 0', async () => {
    const r = await runInteractive('node', ['-e', 'process.exit(0)'])
    expect(r.code).toBe(0)
  })
  it('resolves with a non-zero exit code without throwing', async () => {
    const r = await runInteractive('node', ['-e', 'process.exit(7)'])
    expect(r.code).toBe(7)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/exec.test.ts -t runInteractive`
Expected: FAIL — `runInteractive is not a function` / import error.

- [ ] **Step 3: Write minimal implementation**

Append to `src/exec.ts`:

```typescript
import { spawn as realSpawn } from 'node:child_process'

export function runInteractive(
  cmd: string,
  args: string[],
  deps: { spawn?: typeof realSpawn } = {},
): Promise<{ code: number }> {
  const spawn = deps.spawn ?? realSpawn
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'inherit' })
    child.on('close', (code) => resolve({ code: code ?? 0 }))
    child.on('error', () => resolve({ code: 1 }))
  })
}
```

(Keep the existing `execFile` import line; add the `spawn` import at the top of the file.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/exec.test.ts`
Expected: PASS (all `run` and `runInteractive` tests).

- [ ] **Step 5: Commit**

```bash
git add src/exec.ts test/exec.test.ts
git commit -m "feat: add runInteractive for stdio-inherit child processes"
```

---

### Task 2: `readAuthStatus` in `credentials.ts`

**Files:**
- Modify: `src/credentials.ts`
- Test: `test/credentials.test.ts`

**Interfaces:**
- Consumes: existing `run` DI (`Deps` interface, `credentials.ts:7`).
- Produces: `readAuthStatus(deps?: { run?: typeof run }): Promise<{ loggedIn: boolean; email?: string }>` — runs `claude auth status --json`; returns parsed object, or `{ loggedIn: false }` on non-zero exit or JSON parse failure.

- [ ] **Step 1: Write the failing test**

Add to `test/credentials.test.ts`:

```typescript
import { readAuthStatus } from '../src/credentials.js'

describe('readAuthStatus', () => {
  it('parses loggedIn and email from status json', async () => {
    const run = vi.fn().mockResolvedValue({
      stdout: '{"loggedIn":true,"email":"a@b.com"}', stderr: '', code: 0,
    })
    expect(await readAuthStatus({ run })).toEqual({ loggedIn: true, email: 'a@b.com' })
    expect(run).toHaveBeenCalledWith('claude', ['auth', 'status', '--json'])
  })
  it('returns loggedIn:false on non-zero exit', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: '', stderr: 'nope', code: 1 })
    expect(await readAuthStatus({ run })).toEqual({ loggedIn: false })
  })
  it('returns loggedIn:false on unparseable output', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: 'not json', stderr: '', code: 0 })
    expect(await readAuthStatus({ run })).toEqual({ loggedIn: false })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/credentials.test.ts -t readAuthStatus`
Expected: FAIL — `readAuthStatus is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/credentials.ts`:

```typescript
export async function readAuthStatus(
  deps: Deps = {},
): Promise<{ loggedIn: boolean; email?: string }> {
  const run = deps.run ?? realRun
  const r = await run('claude', ['auth', 'status', '--json'])
  if (r.code !== 0) return { loggedIn: false }
  try {
    const parsed = JSON.parse(r.stdout)
    return { loggedIn: parsed.loggedIn === true, email: parsed.email }
  } catch {
    return { loggedIn: false }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/credentials.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/credentials.ts test/credentials.test.ts
git commit -m "feat: add readAuthStatus reading claude auth status --json"
```

---

### Task 3: `captureLogin` orchestrator

**Files:**
- Create: `src/loginCapture.ts`
- Test: `test/loginCapture.test.ts`

**Interfaces:**
- Consumes: `runInteractive` (Task 1) shape `(cmd, args) => Promise<{ code }>`; `readAuthStatus` (Task 2) shape `() => Promise<{ loggedIn }>`; `hashCredential`/`findDuplicateLoginName` (`fingerprint.ts`); `Profile` (`types.ts`).
- Produces:

```typescript
export interface CaptureLoginDeps {
  profileName: string
  profiles: Profile[]
  runInteractive: (cmd: string, args: string[]) => Promise<{ code: number }>
  readAuthStatus: () => Promise<{ loggedIn: boolean; email?: string }>
  readLiveCredential: () => Promise<string | null>
  writeLiveCredential: (value: string) => Promise<void>
  neutralizeLiveCredential: () => Promise<void>
  setSecret: (value: string) => Promise<void>
  confirmDuplicate: (dupName: string) => Promise<boolean>
  afterCapture?: () => Promise<void>
}
// Returns { credHash } on success; null if aborted (duplicate declined).
// Throws Error if login did not complete. ALWAYS restores the prior live credential.
export async function captureLogin(deps: CaptureLoginDeps): Promise<{ credHash: string } | null>
```

- [ ] **Step 1: Write the failing test**

Create `test/loginCapture.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { captureLogin, type CaptureLoginDeps } from '../src/loginCapture.js'
import { hashCredential } from '../src/fingerprint.js'
import type { Profile } from '../src/types.js'

function baseDeps(over: Partial<CaptureLoginDeps> = {}): CaptureLoginDeps {
  return {
    profileName: 'new',
    profiles: [],
    runInteractive: vi.fn().mockResolvedValue({ code: 0 }),
    readAuthStatus: vi.fn().mockResolvedValue({ loggedIn: true }),
    readLiveCredential: vi.fn()
      .mockResolvedValueOnce('PREV')   // snapshot
      .mockResolvedValueOnce('NEWCRED'), // post-login capture
    writeLiveCredential: vi.fn().mockResolvedValue(undefined),
    neutralizeLiveCredential: vi.fn().mockResolvedValue(undefined),
    setSecret: vi.fn().mockResolvedValue(undefined),
    confirmDuplicate: vi.fn().mockResolvedValue(true),
    ...over,
  }
}

describe('captureLogin', () => {
  it('captures credential, stores it, and restores the previous live credential', async () => {
    const deps = baseDeps()
    const res = await captureLogin(deps)
    expect(res).toEqual({ credHash: hashCredential('NEWCRED') })
    expect(deps.setSecret).toHaveBeenCalledWith('NEWCRED')
    expect(deps.writeLiveCredential).toHaveBeenCalledWith('PREV')
    expect(deps.neutralizeLiveCredential).not.toHaveBeenCalled()
  })

  it('neutralizes the live slot when there was no previous credential', async () => {
    const deps = baseDeps({
      readLiveCredential: vi.fn()
        .mockResolvedValueOnce(null)     // no prior
        .mockResolvedValueOnce('NEWCRED'),
    })
    await captureLogin(deps)
    expect(deps.neutralizeLiveCredential).toHaveBeenCalledTimes(1)
    expect(deps.writeLiveCredential).not.toHaveBeenCalled()
  })

  it('throws and restores when claude auth login exits non-zero', async () => {
    const deps = baseDeps({ runInteractive: vi.fn().mockResolvedValue({ code: 7 }) })
    await expect(captureLogin(deps)).rejects.toThrow(/did not complete/)
    expect(deps.setSecret).not.toHaveBeenCalled()
    expect(deps.writeLiveCredential).toHaveBeenCalledWith('PREV')
  })

  it('throws and restores when status reports not logged in', async () => {
    const deps = baseDeps({ readAuthStatus: vi.fn().mockResolvedValue({ loggedIn: false }) })
    await expect(captureLogin(deps)).rejects.toThrow(/did not complete/)
    expect(deps.writeLiveCredential).toHaveBeenCalledWith('PREV')
  })

  it('aborts (returns null) without saving when a duplicate is declined', async () => {
    const existing: Profile = { name: 'work', type: 'login', env: {}, credHash: hashCredential('NEWCRED') }
    const deps = baseDeps({ profiles: [existing], confirmDuplicate: vi.fn().mockResolvedValue(false) })
    const res = await captureLogin(deps)
    expect(res).toBeNull()
    expect(deps.setSecret).not.toHaveBeenCalled()
    expect(deps.writeLiveCredential).toHaveBeenCalledWith('PREV')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/loginCapture.test.ts`
Expected: FAIL — cannot find module `../src/loginCapture.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/loginCapture.ts`:

```typescript
import { hashCredential, findDuplicateLoginName } from './fingerprint.js'
import type { Profile } from './types.js'

export interface CaptureLoginDeps {
  profileName: string
  profiles: Profile[]
  runInteractive: (cmd: string, args: string[]) => Promise<{ code: number }>
  readAuthStatus: () => Promise<{ loggedIn: boolean; email?: string }>
  readLiveCredential: () => Promise<string | null>
  writeLiveCredential: (value: string) => Promise<void>
  neutralizeLiveCredential: () => Promise<void>
  setSecret: (value: string) => Promise<void>
  confirmDuplicate: (dupName: string) => Promise<boolean>
  afterCapture?: () => Promise<void>
}

export async function captureLogin(
  deps: CaptureLoginDeps,
): Promise<{ credHash: string } | null> {
  const prev = await deps.readLiveCredential()
  try {
    const { code } = await deps.runInteractive('claude', ['auth', 'login'])
    if (code !== 0) throw new Error('claude auth login did not complete — no profile added')
    const status = await deps.readAuthStatus()
    if (!status.loggedIn) throw new Error('login did not complete — no profile added')
    const cred = await deps.readLiveCredential()
    if (cred == null) throw new Error('could not read the new login credential — no profile added')
    const credHash = hashCredential(cred)
    const dup = findDuplicateLoginName(credHash, deps.profiles, deps.profileName)
    if (dup) {
      const proceed = await deps.confirmDuplicate(dup)
      if (!proceed) return null
    }
    await deps.setSecret(cred)
    if (deps.afterCapture) await deps.afterCapture()
    return { credHash }
  } finally {
    if (prev != null) await deps.writeLiveCredential(prev)
    else await deps.neutralizeLiveCredential()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/loginCapture.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/loginCapture.ts test/loginCapture.test.ts
git commit -m "feat: add captureLogin orchestrator for OAuth login capture"
```

---

### Task 4: Wire `captureLogin` into the `add` login branch

**Files:**
- Modify: `src/cli.ts` (imports near lines 8-17; the `login` branch at lines 220-245)
- Test: manual verification (the `add` action is clack-interactive and not unit-tested; `captureLogin` carries the automated coverage from Task 3).

**Interfaces:**
- Consumes: `captureLogin`/`CaptureLoginDeps` (Task 3), `runInteractive` (Task 1), `readAuthStatus` (Task 2), existing `readLiveCredential`/`writeLiveCredential`/`neutralizeLiveCredential`, `setSecret`, `captureOAuthToken`, `listProfiles`, clack.
- Produces: no new exports.

- [ ] **Step 1: Add imports**

In `src/cli.ts`, extend the existing import lines:

```typescript
// line 8: add readAuthStatus
import { writeLiveCredential, neutralizeLiveCredential, readLiveCredential, readAuthStatus } from './credentials.js'
// add near the other src imports:
import { runInteractive } from './exec.js'
import { captureLogin } from './loginCapture.js'
```

Then DELETE the now-duplicate standalone `import { readLiveCredential } from './credentials.js'` at line 14 (it is merged into the line-8 import above). Leave the `hashCredential, findDuplicateLoginName` import (line 17) in place — still used by the `env`/other flows; if a lint check reports it unused after this task, remove only the unused names.

- [ ] **Step 2: Replace the `login` branch body**

Replace the `else { ... }` block at `src/cli.ts:220-245` (the branch after the `bedrock` case, starting `const ready = await clack.confirm(` and ending before `const isolate = await clack.confirm(`) with:

```typescript
      } else {
        clack.log.info(`Launching 'claude auth login' — sign in as the account for '${name}'.`)
        const result = await captureLogin({
          profileName: name,
          profiles: listProfiles(p),
          runInteractive: (cmd, args) => runInteractive(cmd, args),
          readAuthStatus: () => readAuthStatus(),
          readLiveCredential: () => readLiveCredential(plat, p),
          writeLiveCredential: (value) => writeLiveCredential(value, plat, p),
          neutralizeLiveCredential: () => neutralizeLiveCredential(plat, p),
          setSecret: (value) => setSecret(name, value, plat, p),
          confirmDuplicate: async (dupName) => {
            const proceed = await clack.confirm({
              message: `This credential is identical to profile '${dupName}' — you probably didn't log in as a different account. Store it anyway?`,
              initialValue: false,
            })
            return !clack.isCancel(proceed) && proceed === true
          },
          afterCapture: async () => {
            const wantToken = await clack.confirm({ message: 'Capture OAuth token for per-shell use?', initialValue: false })
            if (wantToken === true) {
              try {
                const token = await captureOAuthToken()
                await setSecret(name, token, plat, p, { slot: 'token' })
                profile.hasToken = true
              } catch (err: any) {
                process.stderr.write(`Warning: OAuth token capture skipped: ${err?.message ?? err}\n`)
              }
            }
          },
        })
        if (result == null) return
        profile.credHash = result.credHash
      }
```

Note: this removes the old `readLiveCredential`/`hashCredential`/`findDuplicateLoginName`/`setSecret` calls that were inline in this branch — they now live inside `captureLogin` and the callbacks above. The `profile` object (declared at `cli.ts:204`) is captured by the `afterCapture` closure, so `profile.hasToken`/`profile.credHash` mutate the same object that `saveProfile` writes.

- [ ] **Step 3: Typecheck and run the full test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests PASS (existing `cli` tests for api-key/bedrock/bedrock-key untouched and green).

- [ ] **Step 4: Build and manually verify end-to-end**

Run: `npm run build` (produces `dist/`).

Manual check (real login required — do this yourself, it cannot be automated because it opens a browser):
1. Note the current live account: `claude auth status --json` → record `email`.
2. `node dist/bin.js add` → name it `oauth-test`, choose "Subscription login (OAuth)".
3. Confirm `claude auth login` launches; complete the browser sign-in as a DIFFERENT account (or the same, to see the duplicate warning).
4. Decline the per-shell token prompt.
5. Verify: `node dist/bin.js list` shows `oauth-test (login)`.
6. Verify the machine login was RESTORED: `claude auth status --json` → `email` matches step 1's value.
7. Cleanup: `node dist/bin.js remove oauth-test` (or the equivalent remove command).

Expected: profile added with a stored credential; live login unchanged from step 1.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts
git commit -m "feat: drive claude auth login during add with prev-login restore"
```

---

## Self-Review

- **Spec coverage:** always-launch (Task 4 Step 2, no confirm) ✓; bare `claude auth login` (Task 3 impl) ✓; confirm via `auth status --json` loggedIn (Task 2 + Task 3) ✓; restore-previous in `finally`, neutralize when null (Task 3 + tests) ✓; `runInteractive` in `exec.ts` (Task 1) ✓; duplicate detection unchanged (Task 3 test + `confirmDuplicate` callback) ✓; optional per-shell token capture unchanged (Task 4 `afterCapture`) ✓; api-key/bedrock/bedrock-key untouched (Task 4 only edits the `login` branch) ✓.
- **Placeholder scan:** none — all steps carry concrete code/commands.
- **Type consistency:** `runInteractive` returns `{ code }` in Task 1 and is consumed with that shape in Task 3/4; `readAuthStatus` returns `{ loggedIn, email? }` consistently; `captureLogin` returns `{ credHash } | null`, consumed as `result.credHash` / `result == null` in Task 4.
