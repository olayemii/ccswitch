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
