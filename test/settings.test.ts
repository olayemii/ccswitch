import { describe, it, expect } from 'vitest'
import { patchSettings } from '../src/settings.js'

describe('patchSettings', () => {
  it('sets managed env keys without touching user keys', () => {
    const current = { env: { MY_OWN: 'keep', ANTHROPIC_API_KEY: 'old' }, theme: 'dark' }
    const { settings, managedKeys } = patchSettings(
      current,
      { env: { ANTHROPIC_API_KEY: 'new' } },
      ['env.ANTHROPIC_API_KEY'],
    )
    expect(settings.env.ANTHROPIC_API_KEY).toBe('new')
    expect(settings.env.MY_OWN).toBe('keep')
    expect(settings.theme).toBe('dark')
    expect(managedKeys).toEqual(['env.ANTHROPIC_API_KEY'])
  })

  it('clears previously-managed keys no longer desired', () => {
    const current = { env: { ANTHROPIC_API_KEY: 'old', CLAUDE_CODE_USE_BEDROCK: '1' } }
    const { settings, managedKeys } = patchSettings(
      current,
      { env: { CLAUDE_CODE_USE_BEDROCK: '1' } },
      ['env.ANTHROPIC_API_KEY', 'env.CLAUDE_CODE_USE_BEDROCK'],
    )
    expect(settings.env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(settings.env.CLAUDE_CODE_USE_BEDROCK).toBe('1')
    expect(managedKeys.sort()).toEqual(['env.CLAUDE_CODE_USE_BEDROCK'])
  })

  it('manages AWS_BEARER_TOKEN_BEDROCK: sets on switch-in, clears on switch-away', () => {
    const set = patchSettings(
      { env: { KEEP: 'me' } },
      { env: { CLAUDE_CODE_USE_BEDROCK: '1', AWS_BEARER_TOKEN_BEDROCK: 'tok' } },
      [],
    )
    expect(set.settings.env.AWS_BEARER_TOKEN_BEDROCK).toBe('tok')
    expect(set.settings.env.KEEP).toBe('me')
    expect(set.managedKeys).toContain('env.AWS_BEARER_TOKEN_BEDROCK')

    const cleared = patchSettings(
      { env: { AWS_BEARER_TOKEN_BEDROCK: 'tok', CLAUDE_CODE_USE_BEDROCK: '1' } },
      { env: { ANTHROPIC_API_KEY: 'sk' } },
      ['env.AWS_BEARER_TOKEN_BEDROCK', 'env.CLAUDE_CODE_USE_BEDROCK'],
    )
    expect(cleared.settings.env.AWS_BEARER_TOKEN_BEDROCK).toBeUndefined()
  })

  it('sets and clears apiKeyHelper', () => {
    const set = patchSettings({}, { apiKeyHelper: '/path/helper.sh' }, [])
    expect(set.settings.apiKeyHelper).toBe('/path/helper.sh')
    expect(set.managedKeys).toContain('apiKeyHelper')

    const cleared = patchSettings(
      { apiKeyHelper: '/path/helper.sh' },
      { apiKeyHelper: null },
      ['apiKeyHelper'],
    )
    expect(cleared.settings.apiKeyHelper).toBeUndefined()
    expect(cleared.managedKeys).not.toContain('apiKeyHelper')
  })

  it('does not mutate the input object', () => {
    const current = { env: { ANTHROPIC_API_KEY: 'old' } }
    patchSettings(current, { env: { ANTHROPIC_API_KEY: 'new' } }, [])
    expect(current.env.ANTHROPIC_API_KEY).toBe('old')
  })
})

import { describe as describeIO, it as itIO, expect as expectIO } from 'vitest'
import { loadSettings, saveSettings } from '../src/settings.js'
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describeIO('settings file IO', () => {
  itIO('loads {} for missing file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccs-'))
    expectIO(loadSettings(join(dir, 'nope.json'))).toEqual({})
  })

  itIO('backs up existing file before saving', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccs-'))
    const file = join(dir, 'settings.json')
    writeFileSync(file, JSON.stringify({ theme: 'dark' }))
    saveSettings(file, { theme: 'light' }, '2026-07-09T00:00:00Z')
    const bak = join(dir, 'settings.json.bak.2026-07-09T00:00:00Z')
    expectIO(existsSync(bak)).toBe(true)
    expectIO(JSON.parse(readFileSync(bak, 'utf8')).theme).toBe('dark')
    expectIO(JSON.parse(readFileSync(file, 'utf8')).theme).toBe('light')
  })

  itIO('does not back up when file is absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccs-'))
    const file = join(dir, 'settings.json')
    saveSettings(file, { a: 1 }, '2026-07-09T00:00:00Z')
    expectIO(existsSync(join(dir, 'settings.json.bak.2026-07-09T00:00:00Z'))).toBe(false)
    expectIO(existsSync(file)).toBe(true)
  })
})
