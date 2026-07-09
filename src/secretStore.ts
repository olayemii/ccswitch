import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { run as realRun } from './exec.js'
import { usesKeychain, type Paths } from './platform.js'
import type { Platform } from './types.js'

interface Deps { run?: typeof realRun }
export type SecretSlot = 'secret' | 'token'
interface SecretOpts extends Deps { slot?: SecretSlot }

const SERVICE = (name: string) => `ccswitch:${name}`

const slotFile = (paths: Paths, name: string, slot: SecretSlot): string =>
  slot === 'token' ? join(paths.secretsDir, `${name}.token`) : join(paths.secretsDir, name)

export async function resolveLoginKeychain(deps: Deps = {}): Promise<string> {
  const run = deps.run ?? realRun
  const r = await run('security', ['login-keychain'])
  if (r.code === 0 && r.stdout.trim().length > 0) {
    return r.stdout.trim().replace(/^"|"$/g, '')
  }
  return `${process.env.HOME}/Library/Keychains/login.keychain-db`
}

export async function setSecret(name: string, value: string, plat: Platform, paths: Paths, opts: SecretOpts = {}): Promise<void> {
  const run = opts.run ?? realRun
  const slot = opts.slot ?? 'secret'
  if (usesKeychain(plat)) {
    const keychain = await resolveLoginKeychain({ run })
    await run('security', ['add-generic-password', '-s', SERVICE(name), '-a', slot, '-w', value, '-U', keychain])
    return
  }
  mkdirSync(paths.secretsDir, { recursive: true, mode: 0o700 })
  writeFileSync(slotFile(paths, name, slot), value, { encoding: 'utf8', mode: 0o600 })
}

export async function getSecret(name: string, plat: Platform, paths: Paths, opts: SecretOpts = {}): Promise<string | null> {
  const run = opts.run ?? realRun
  const slot = opts.slot ?? 'secret'
  if (usesKeychain(plat)) {
    const keychain = await resolveLoginKeychain({ run })
    const r = await run('security', ['find-generic-password', '-s', SERVICE(name), '-a', slot, '-w', keychain])
    if (r.code !== 0) return null
    return r.stdout.replace(/\n$/, '')
  }
  const file = slotFile(paths, name, slot)
  if (!existsSync(file)) return null
  return readFileSync(file, 'utf8')
}

export async function deleteSecret(name: string, plat: Platform, paths: Paths, opts: SecretOpts = {}): Promise<void> {
  const run = opts.run ?? realRun
  const slot = opts.slot ?? 'secret'
  if (usesKeychain(plat)) {
    const keychain = await resolveLoginKeychain({ run })
    await run('security', ['delete-generic-password', '-s', SERVICE(name), '-a', slot, keychain])
    return
  }
  const file = slotFile(paths, name, slot)
  if (existsSync(file)) rmSync(file)
}
