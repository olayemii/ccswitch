import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { run as realRun } from './exec.js'
import { usesKeychain, type Paths } from './platform.js'
import type { Platform } from './types.js'
import { resolveLoginKeychain } from './secretStore.js'

interface Deps { run?: typeof realRun }
const LIVE_SERVICE = 'Claude Code-credentials'

// Claude Code stores its OAuth credential in the login keychain under
// account = the OS username (e.g. "olayemii"), NOT a fixed string. If we
// read/write a different account (we used to hardcode "default"), we operate
// on a separate keychain item that Claude Code never reads — so switches
// silently have no effect. Resolve the account of the item Claude actually
// uses by reading the existing item's `acct` attribute, falling back to
// $USER for a fresh machine where no live item exists yet.
async function resolveLiveAccount(run: typeof realRun, keychain: string): Promise<string> {
  const r = await run('security', ['find-generic-password', '-s', LIVE_SERVICE, keychain])
  if (r.code === 0) {
    const m = `${r.stdout}\n${r.stderr}`.match(/"acct"<blob>="([^"]*)"/)
    if (m) return m[1]
  }
  return process.env.USER || process.env.USERNAME || 'default'
}

export async function readLiveCredential(plat: Platform, paths: Paths, deps: Deps = {}): Promise<string | null> {
  const run = deps.run ?? realRun
  if (usesKeychain(plat)) {
    const keychain = await resolveLoginKeychain({ run })
    const acct = await resolveLiveAccount(run, keychain)
    const r = await run('security', ['find-generic-password', '-s', LIVE_SERVICE, '-a', acct, '-w', keychain])
    if (r.code !== 0) return null
    return r.stdout.replace(/\n$/, '')
  }
  if (!existsSync(paths.credentialsFile)) return null
  return readFileSync(paths.credentialsFile, 'utf8')
}

export async function writeLiveCredential(value: string, plat: Platform, paths: Paths, deps: Deps = {}): Promise<void> {
  const run = deps.run ?? realRun
  if (usesKeychain(plat)) {
    const keychain = await resolveLoginKeychain({ run })
    const acct = await resolveLiveAccount(run, keychain)
    await run('security', ['add-generic-password', '-s', LIVE_SERVICE, '-a', acct, '-w', value, '-U', keychain])
    return
  }
  writeFileSync(paths.credentialsFile, value, { encoding: 'utf8', mode: 0o600 })
}

export async function neutralizeLiveCredential(plat: Platform, paths: Paths, deps: Deps = {}): Promise<void> {
  const run = deps.run ?? realRun
  if (usesKeychain(plat)) {
    const keychain = await resolveLoginKeychain({ run })
    const acct = await resolveLiveAccount(run, keychain)
    await run('security', ['delete-generic-password', '-s', LIVE_SERVICE, '-a', acct, keychain])
    return
  }
  if (existsSync(paths.credentialsFile)) rmSync(paths.credentialsFile)
}

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
