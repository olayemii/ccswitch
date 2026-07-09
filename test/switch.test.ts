import { describe, it, expect, vi } from 'vitest'
import { globalSwitch } from '../src/switch.js'
import type { Paths } from '../src/platform.js'

function baseDeps(overrides = {}) {
  const paths = { ccswitchDir: '/cc', profilesDir: '/cc/profiles', secretsDir: '/cc/secrets', homesDir: '/cc/homes', activeFile: '/cc/active.json', claudeConfigDir: '/cl', settingsFile: '/cl/settings.json', credentialsFile: '/cl/.credentials.json' } as Paths
  let savedSettings: any = null
  return {
    paths,
    savedRef: () => savedSettings,
    deps: {
      plat: 'linux' as const,
      paths,
      now: '2026-07-09T00:00:00Z',
      loadSettings: vi.fn().mockReturnValue({ theme: 'dark' }),
      saveSettings: vi.fn((_f: string, s: any) => { savedSettings = s }),
      getSecret: vi.fn().mockResolvedValue('sk-live'),
      writeLiveCredential: vi.fn().mockResolvedValue(undefined),
      neutralizeLiveCredential: vi.fn().mockResolvedValue(undefined),
      readActive: vi.fn().mockReturnValue(null),
      writeActive: vi.fn(),
      writeApiKeyHelper: vi.fn().mockReturnValue('/cc/apikey-helper.sh'),
      ...overrides,
    },
  }
}

describe('globalSwitch', () => {
  it('login restores credential and clears apiKeyHelper, preserves user keys', async () => {
    const t = baseDeps()
    await globalSwitch({ name: 'work', type: 'login', env: {} }, t.deps as any)
    expect(t.deps.writeLiveCredential).toHaveBeenCalledWith('sk-live', 'linux', t.paths)
    expect(t.savedRef().theme).toBe('dark')
    expect(t.savedRef().apiKeyHelper).toBeUndefined()
    expect(t.deps.writeActive).toHaveBeenCalledWith({ name: 'work', managedKeys: [] }, t.paths)
  })

  it('api-key sets apiKeyHelper and neutralizes login', async () => {
    const t = baseDeps()
    await globalSwitch({ name: 'k', type: 'api-key', env: {} }, t.deps as any)
    expect(t.savedRef().apiKeyHelper).toBe('/cc/apikey-helper.sh')
    expect(t.deps.neutralizeLiveCredential).toHaveBeenCalled()
    expect(t.deps.writeActive).toHaveBeenCalledWith({ name: 'k', managedKeys: ['apiKeyHelper'] }, t.paths)
  })

  it('bedrock sets aws env and neutralizes login', async () => {
    const t = baseDeps()
    await globalSwitch({ name: 'bd', type: 'bedrock', env: { CLAUDE_CODE_USE_BEDROCK: '1', AWS_PROFILE: 'p', AWS_REGION: 'us-east-1' } }, t.deps as any)
    expect(t.savedRef().env.CLAUDE_CODE_USE_BEDROCK).toBe('1')
    expect(t.savedRef().env.AWS_PROFILE).toBe('p')
    expect(t.deps.neutralizeLiveCredential).toHaveBeenCalled()
  })

  it('clears keys managed by the previous profile', async () => {
    const t = baseDeps({ readActive: vi.fn().mockReturnValue({ name: 'old', managedKeys: ['env.CLAUDE_CODE_USE_BEDROCK'] }), loadSettings: vi.fn().mockReturnValue({ env: { CLAUDE_CODE_USE_BEDROCK: '1' } }) })
    await globalSwitch({ name: 'work', type: 'login', env: {} }, t.deps as any)
    expect(t.savedRef().env?.CLAUDE_CODE_USE_BEDROCK).toBeUndefined()
  })
})
