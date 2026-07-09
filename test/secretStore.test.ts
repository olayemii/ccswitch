import { describe, it, expect, vi } from 'vitest'
import { getSecret, setSecret, deleteSecret, resolveLoginKeychain } from '../src/secretStore.js'
import { mkdtempSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Paths } from '../src/platform.js'

function tmpPaths(): Paths {
  const dir = mkdtempSync(join(tmpdir(), 'ccs-'))
  return {
    ccswitchDir: dir, profilesDir: join(dir, 'profiles'), secretsDir: join(dir, 'secrets'),
    homesDir: join(dir, 'homes'), activeFile: join(dir, 'active.json'),
    claudeConfigDir: join(dir, '.claude'), settingsFile: join(dir, 's.json'),
    credentialsFile: join(dir, 'c.json'),
  }
}

describe('secretStore file backend (linux/win)', () => {
  it('round-trips a secret and stores 0600', async () => {
    const p = tmpPaths()
    await setSecret('work', 'sk-123', 'linux', p)
    expect(await getSecret('work', 'linux', p)).toBe('sk-123')
    const mode = statSync(join(p.secretsDir, 'work')).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('returns null for missing secret', async () => {
    const p = tmpPaths()
    expect(await getSecret('nope', 'linux', p)).toBeNull()
  })

  it('deletes a secret', async () => {
    const p = tmpPaths()
    await setSecret('x', 'v', 'linux', p)
    await deleteSecret('x', 'linux', p)
    expect(existsSync(join(p.secretsDir, 'x'))).toBe(false)
  })

  it('creates secretsDir with mode 0700', async () => {
    const p = tmpPaths()
    await setSecret('x', 'v', 'linux', p)
    const mode = statSync(p.secretsDir).mode & 0o777
    expect(mode).toBe(0o700)
  })

  it('coexists a secret and a token slot for the same name with distinct values and files', async () => {
    const p = tmpPaths()
    await setSecret('login', 'oauth-cred', 'linux', p, { slot: 'secret' })
    await setSecret('login', 'captured-token', 'linux', p, { slot: 'token' })

    expect(await getSecret('login', 'linux', p, { slot: 'secret' })).toBe('oauth-cred')
    expect(await getSecret('login', 'linux', p, { slot: 'token' })).toBe('captured-token')
    // default slot reads the 'secret' file
    expect(await getSecret('login', 'linux', p)).toBe('oauth-cred')

    expect(existsSync(join(p.secretsDir, 'login'))).toBe(true)
    expect(existsSync(join(p.secretsDir, 'login.token'))).toBe(true)
  })
})

describe('secretStore keychain backend (darwin)', () => {
  it('sets via security add-generic-password', async () => {
    const p = tmpPaths()
    const run = vi.fn().mockResolvedValue({ stdout: '', stderr: '', code: 0 })
    await setSecret('work', 'sk-123', 'darwin', p, { run })
    expect(run).toHaveBeenCalledWith(
      'security',
      expect.arrayContaining(['add-generic-password', '-s', 'ccswitch:work', '-a', 'secret', '-w', 'sk-123', '-U']),
    )
  })

  it('reads via security find-generic-password -w', async () => {
    const p = tmpPaths()
    const run = vi.fn().mockResolvedValue({ stdout: 'sk-123\n', stderr: '', code: 0 })
    expect(await getSecret('work', 'darwin', p, { run })).toBe('sk-123')
  })

  it('returns null when keychain item missing (code 44)', async () => {
    const p = tmpPaths()
    const run = vi.fn().mockResolvedValue({ stdout: '', stderr: 'not found', code: 44 })
    expect(await getSecret('work', 'darwin', p, { run })).toBeNull()
  })

  it('uses -a token for the token slot and -a secret for the secret slot', async () => {
    const p = tmpPaths()
    const run = vi.fn().mockResolvedValue({ stdout: '', stderr: '', code: 0 })
    await setSecret('login', 'tok-value', 'darwin', p, { slot: 'token', run })
    expect(run).toHaveBeenCalledWith(
      'security',
      expect.arrayContaining(['add-generic-password', '-s', 'ccswitch:login', '-a', 'token', '-w', 'tok-value', '-U']),
    )

    run.mockClear()
    await setSecret('login', 'cred-value', 'darwin', p, { slot: 'secret', run })
    expect(run).toHaveBeenCalledWith(
      'security',
      expect.arrayContaining(['add-generic-password', '-s', 'ccswitch:login', '-a', 'secret', '-w', 'cred-value', '-U']),
    )
  })

  it('appends the resolved login keychain as the trailing arg on add/find/delete', async () => {
    const p = tmpPaths()
    const keychainPath = '/Users/someone/Library/Keychains/login.keychain-db'
    const run = vi.fn().mockImplementation(async (cmd: string, args: string[]) => {
      if (args[0] === 'login-keychain') {
        return { stdout: `    "${keychainPath}"\n`, stderr: '', code: 0 }
      }
      return { stdout: 'value\n', stderr: '', code: 0 }
    })

    await setSecret('work', 'v', 'darwin', p, { run })
    expect(run).toHaveBeenCalledWith('security', expect.arrayContaining(['add-generic-password']))
    let addCallArgs = run.mock.calls.find((c) => c[1][0] === 'add-generic-password')![1] as string[]
    expect(addCallArgs[addCallArgs.length - 1]).toBe(keychainPath)

    run.mockClear()
    await getSecret('work', 'darwin', p, { run })
    let findCallArgs = run.mock.calls.find((c) => c[1][0] === 'find-generic-password')![1] as string[]
    expect(findCallArgs[findCallArgs.length - 1]).toBe(keychainPath)

    run.mockClear()
    await deleteSecret('work', 'darwin', p, { run })
    let deleteCallArgs = run.mock.calls.find((c) => c[1][0] === 'delete-generic-password')![1] as string[]
    expect(deleteCallArgs[deleteCallArgs.length - 1]).toBe(keychainPath)
  })
})

describe('resolveLoginKeychain', () => {
  it('strips quotes and whitespace on success', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: '    "/Users/x/Library/Keychains/login.keychain-db"\n', stderr: '', code: 0 })
    expect(await resolveLoginKeychain({ run })).toBe('/Users/x/Library/Keychains/login.keychain-db')
  })

  it('invokes `security login-keychain` without the -d user filter', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: '    "/k/login.keychain-db"\n', stderr: '', code: 0 })
    await resolveLoginKeychain({ run })
    expect(run).toHaveBeenCalledWith('security', ['login-keychain'])
  })

  it('falls back to HOME default when the command fails', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: '', stderr: 'error', code: 1 })
    expect(await resolveLoginKeychain({ run })).toBe(`${process.env.HOME}/Library/Keychains/login.keychain-db`)
  })

  it('falls back to HOME default when stdout is empty', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: '', stderr: '', code: 0 })
    expect(await resolveLoginKeychain({ run })).toBe(`${process.env.HOME}/Library/Keychains/login.keychain-db`)
  })
})
