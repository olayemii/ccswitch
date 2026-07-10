import { describe, it, expect, vi } from 'vitest'
import { readLiveCredential, writeLiveCredential, neutralizeLiveCredential, readAuthStatus } from '../src/credentials.js'
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Paths } from '../src/platform.js'

function tmpPaths(): Paths {
  const dir = mkdtempSync(join(tmpdir(), 'ccs-'))
  return {
    ccswitchDir: dir, profilesDir: join(dir, 'profiles'), secretsDir: join(dir, 'secrets'),
    homesDir: join(dir, 'homes'), activeFile: join(dir, 'active.json'),
    claudeConfigDir: dir, settingsFile: join(dir, 's.json'),
    credentialsFile: join(dir, '.credentials.json'),
    claudeJsonFile: join(dir, '.claude.json'),
  }
}

describe('credentials file backend', () => {
  it('reads null when absent, writes then reads', async () => {
    const p = tmpPaths()
    expect(await readLiveCredential('linux', p)).toBeNull()
    await writeLiveCredential('{"token":"x"}', 'linux', p)
    expect(await readLiveCredential('linux', p)).toBe('{"token":"x"}')
  })

  it('neutralize deletes the file', async () => {
    const p = tmpPaths()
    writeFileSync(p.credentialsFile, '{"token":"x"}')
    await neutralizeLiveCredential('linux', p)
    expect(existsSync(p.credentialsFile)).toBe(false)
  })
})

describe('credentials keychain backend', () => {
  it('reads from Claude Code-credentials service', async () => {
    const p = tmpPaths()
    const run = vi.fn().mockResolvedValue({ stdout: '{"t":1}\n', stderr: '', code: 0 })
    expect(await readLiveCredential('darwin', p, { run })).toBe('{"t":1}')
    expect(run).toHaveBeenCalledWith('security', expect.arrayContaining(['find-generic-password', '-s', 'Claude Code-credentials', '-w']))
  })

  it('read/write/neutralize target the account of the existing live item', async () => {
    const p = tmpPaths()
    // resolution: find without -w returns the existing item's attributes
    const run = vi.fn().mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'find-generic-password' && !args.includes('-w')) {
        return { stdout: '    "acct"<blob>="olayemii"\n    "svce"<blob>="Claude Code-credentials"\n', stderr: '', code: 0 }
      }
      return { stdout: '{"t":1}\n', stderr: '', code: 0 }
    })

    await readLiveCredential('darwin', p, { run })
    expect(run).toHaveBeenCalledWith('security', expect.arrayContaining(['find-generic-password', '-s', 'Claude Code-credentials', '-a', 'olayemii', '-w']))

    run.mockClear()
    run.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'find-generic-password' && !args.includes('-w')) {
        return { stdout: '    "acct"<blob>="olayemii"\n', stderr: '', code: 0 }
      }
      return { stdout: '', stderr: '', code: 0 }
    })
    await writeLiveCredential('{"t":1}', 'darwin', p, { run })
    expect(run).toHaveBeenCalledWith('security', expect.arrayContaining(['add-generic-password', '-s', 'Claude Code-credentials', '-a', 'olayemii', '-U']))

    await neutralizeLiveCredential('darwin', p, { run })
    expect(run).toHaveBeenCalledWith('security', expect.arrayContaining(['delete-generic-password', '-s', 'Claude Code-credentials', '-a', 'olayemii']))
  })

  it('falls back to $USER when no live item exists yet', async () => {
    const p = tmpPaths()
    vi.stubEnv('USER', 'bob')
    const run = vi.fn().mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'find-generic-password' && !args.includes('-w')) {
        return { stdout: '', stderr: 'not found', code: 44 }
      }
      return { stdout: '', stderr: '', code: 0 }
    })
    await writeLiveCredential('{"t":1}', 'darwin', p, { run })
    expect(run).toHaveBeenCalledWith('security', expect.arrayContaining(['add-generic-password', '-s', 'Claude Code-credentials', '-a', 'bob', '-U']))
    vi.unstubAllEnvs()
  })

  it('appends the resolved login keychain as the trailing arg on read/write/neutralize', async () => {
    const p = tmpPaths()
    const keychainPath = '/Users/someone/Library/Keychains/login.keychain-db'
    const run = vi.fn().mockImplementation(async (cmd: string, args: string[]) => {
      if (args[0] === 'login-keychain') {
        return { stdout: `    "${keychainPath}"\n`, stderr: '', code: 0 }
      }
      return { stdout: '{"t":1}\n', stderr: '', code: 0 }
    })

    await writeLiveCredential('{"t":1}', 'darwin', p, { run })
    let addArgs = run.mock.calls.find((c) => c[1][0] === 'add-generic-password')![1] as string[]
    expect(addArgs[addArgs.length - 1]).toBe(keychainPath)

    run.mockClear()
    await readLiveCredential('darwin', p, { run })
    let findArgs = run.mock.calls.find((c) => c[1][0] === 'find-generic-password')![1] as string[]
    expect(findArgs[findArgs.length - 1]).toBe(keychainPath)

    run.mockClear()
    await neutralizeLiveCredential('darwin', p, { run })
    let deleteArgs = run.mock.calls.find((c) => c[1][0] === 'delete-generic-password')![1] as string[]
    expect(deleteArgs[deleteArgs.length - 1]).toBe(keychainPath)
  })
})

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
