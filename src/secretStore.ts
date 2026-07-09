import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { run as realRun } from './exec.js'
import { usesKeychain, type Paths } from './platform.js'
import type { Platform } from './types.js'

interface Deps { run?: typeof realRun }
const SERVICE = (name: string) => `ccswitch:${name}`

export async function setSecret(name: string, value: string, plat: Platform, paths: Paths, deps: Deps = {}): Promise<void> {
  const run = deps.run ?? realRun
  if (usesKeychain(plat)) {
    await run('security', ['add-generic-password', '-s', SERVICE(name), '-a', 'secret', '-w', value, '-U'])
    return
  }
  mkdirSync(paths.secretsDir, { recursive: true })
  const file = join(paths.secretsDir, name)
  writeFileSync(file, value, { encoding: 'utf8', mode: 0o600 })
}

export async function getSecret(name: string, plat: Platform, paths: Paths, deps: Deps = {}): Promise<string | null> {
  const run = deps.run ?? realRun
  if (usesKeychain(plat)) {
    const r = await run('security', ['find-generic-password', '-s', SERVICE(name), '-a', 'secret', '-w'])
    if (r.code !== 0) return null
    return r.stdout.replace(/\n$/, '')
  }
  const file = join(paths.secretsDir, name)
  if (!existsSync(file)) return null
  return readFileSync(file, 'utf8')
}

export async function deleteSecret(name: string, plat: Platform, paths: Paths, deps: Deps = {}): Promise<void> {
  const run = deps.run ?? realRun
  if (usesKeychain(plat)) {
    await run('security', ['delete-generic-password', '-s', SERVICE(name), '-a', 'secret'])
    return
  }
  const file = join(paths.secretsDir, name)
  if (existsSync(file)) rmSync(file)
}
