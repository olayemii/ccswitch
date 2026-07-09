import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { run as realRun } from './exec.js'
import { usesKeychain, type Paths } from './platform.js'
import type { Platform } from './types.js'

interface Deps { run?: typeof realRun }
const LIVE_SERVICE = 'Claude Code-credentials'

export async function readLiveCredential(plat: Platform, paths: Paths, deps: Deps = {}): Promise<string | null> {
  const run = deps.run ?? realRun
  if (usesKeychain(plat)) {
    const r = await run('security', ['find-generic-password', '-s', LIVE_SERVICE, '-w'])
    if (r.code !== 0) return null
    return r.stdout.replace(/\n$/, '')
  }
  if (!existsSync(paths.credentialsFile)) return null
  return readFileSync(paths.credentialsFile, 'utf8')
}

export async function writeLiveCredential(value: string, plat: Platform, paths: Paths, deps: Deps = {}): Promise<void> {
  const run = deps.run ?? realRun
  if (usesKeychain(plat)) {
    await run('security', ['add-generic-password', '-s', LIVE_SERVICE, '-a', 'default', '-w', value, '-U'])
    return
  }
  writeFileSync(paths.credentialsFile, value, { encoding: 'utf8', mode: 0o600 })
}

export async function neutralizeLiveCredential(plat: Platform, paths: Paths, deps: Deps = {}): Promise<void> {
  const run = deps.run ?? realRun
  if (usesKeychain(plat)) {
    await run('security', ['delete-generic-password', '-s', LIVE_SERVICE])
    return
  }
  if (existsSync(paths.credentialsFile)) rmSync(paths.credentialsFile)
}
