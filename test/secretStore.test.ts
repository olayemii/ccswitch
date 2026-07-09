import { describe, it, expect, vi } from 'vitest'
import { getSecret, setSecret, deleteSecret } from '../src/secretStore.js'
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
})
