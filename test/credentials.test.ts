import { describe, it, expect, vi } from 'vitest'
import { readLiveCredential, writeLiveCredential, neutralizeLiveCredential } from '../src/credentials.js'
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

  it('neutralize calls delete-generic-password', async () => {
    const p = tmpPaths()
    const run = vi.fn().mockResolvedValue({ stdout: '', stderr: '', code: 0 })
    await neutralizeLiveCredential('darwin', p, { run })
    expect(run).toHaveBeenCalledWith('security', expect.arrayContaining(['delete-generic-password', '-s', 'Claude Code-credentials']))
  })
})
