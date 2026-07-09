import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Paths } from '../src/platform.js'

vi.mock('../src/secretStore.js', () => ({
  resolveLoginKeychain: vi.fn().mockResolvedValue('/Users/me/Library/Keychains/login.keychain-db'),
}))

const { buildApiKeyHelperCommand, captureOAuthToken } = await import('../src/helpers.js')

function tmpPaths(): Paths {
  const dir = mkdtempSync(join(tmpdir(), 'ccs-'))
  return { ccswitchDir: dir, profilesDir: join(dir, 'profiles'), secretsDir: join(dir, 'secrets'), homesDir: join(dir, 'homes'), activeFile: join(dir, 'active.json'), claudeConfigDir: dir, settingsFile: join(dir, 's.json'), credentialsFile: join(dir, 'c.json') }
}

describe('buildApiKeyHelperCommand', () => {
  it('darwin: returns a security find-generic-password command using the resolved login keychain', async () => {
    const p = tmpPaths()
    const cmd = await buildApiKeyHelperCommand({ name: 'k', type: 'api-key', env: {} }, 'darwin', p)
    expect(cmd).toBe("security find-generic-password -s 'ccswitch:k' -a secret -w '/Users/me/Library/Keychains/login.keychain-db'")
    expect(cmd).not.toContain('sk-')
  })

  it('linux: returns a cat command reading the secrets file', async () => {
    const p = tmpPaths()
    const cmd = await buildApiKeyHelperCommand({ name: 'k', type: 'api-key', env: {} }, 'linux', p)
    expect(cmd).toBe(`cat '${join(p.secretsDir, 'k')}'`)
    expect(cmd).not.toContain('sk-')
  })

  it('win32: returns a type command reading the secrets file with windows-style quoting', async () => {
    const p = tmpPaths()
    const cmd = await buildApiKeyHelperCommand({ name: 'k', type: 'api-key', env: {} }, 'win32', p)
    expect(cmd).toBe(`type "${join(p.secretsDir, 'k')}"`)
    expect(cmd).not.toContain('sk-')
  })
})

describe('captureOAuthToken', () => {
  it('returns trimmed token on success', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: '  tok-abc \n', stderr: '', code: 0 })
    expect(await captureOAuthToken({ run })).toBe('tok-abc')
  })
  it('throws on non-zero exit', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: '', stderr: 'nope', code: 1 })
    await expect(captureOAuthToken({ run })).rejects.toThrow(/setup-token/)
  })
})
