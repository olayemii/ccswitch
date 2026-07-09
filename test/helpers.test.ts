import { describe, it, expect, vi } from 'vitest'
import { writeApiKeyHelper, captureOAuthToken } from '../src/helpers.js'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Paths } from '../src/platform.js'

function tmpPaths(): Paths {
  const dir = mkdtempSync(join(tmpdir(), 'ccs-'))
  return { ccswitchDir: dir, profilesDir: join(dir, 'profiles'), secretsDir: join(dir, 'secrets'), homesDir: join(dir, 'homes'), activeFile: join(dir, 'active.json'), claudeConfigDir: dir, settingsFile: join(dir, 's.json'), credentialsFile: join(dir, 'c.json') }
}

describe('writeApiKeyHelper', () => {
  it('writes a 0700 script that echoes the key', () => {
    const p = tmpPaths()
    const path = writeApiKeyHelper({ name: 'k', type: 'api-key', env: {} }, 'sk-42', p)
    const content = readFileSync(path, 'utf8')
    expect(content).toContain('sk-42')
    expect(statSync(path).mode & 0o777).toBe(0o700)
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
