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
      writeApiKeyHelper: vi.fn().mockResolvedValue("cat '/cc/secrets/k'"),
      loadProfile: vi.fn(),
      readLiveCredential: vi.fn().mockResolvedValue(null),
      setSecret: vi.fn().mockResolvedValue(undefined),
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
    expect(t.deps.writeApiKeyHelper).toHaveBeenCalledWith({ name: 'k', type: 'api-key', env: {} })
    expect(t.savedRef().apiKeyHelper).toBe("cat '/cc/secrets/k'")
    expect(t.deps.neutralizeLiveCredential).toHaveBeenCalled()
    expect(t.deps.writeActive).toHaveBeenCalledWith({ name: 'k', managedKeys: ['apiKeyHelper'] }, t.paths)
  })

  it('bedrock-key injects AWS_BEARER_TOKEN_BEDROCK into settings, marks it managed, and neutralizes login', async () => {
    const t = baseDeps({ getSecret: vi.fn().mockResolvedValue('brk-token') })
    await globalSwitch({ name: 'bk', type: 'bedrock-key', env: { CLAUDE_CODE_USE_BEDROCK: '1', AWS_REGION: 'us-west-2' } }, t.deps as any)
    expect(t.savedRef().env.AWS_BEARER_TOKEN_BEDROCK).toBe('brk-token')
    expect(t.savedRef().env.CLAUDE_CODE_USE_BEDROCK).toBe('1')
    expect(t.deps.neutralizeLiveCredential).toHaveBeenCalled()
    expect(t.deps.writeActive).toHaveBeenCalledWith(
      { name: 'bk', managedKeys: expect.arrayContaining(['env.AWS_BEARER_TOKEN_BEDROCK']) },
      t.paths,
    )
  })

  it('bedrock-key throws when no token is stored and does not touch settings', async () => {
    const t = baseDeps({ getSecret: vi.fn().mockResolvedValue(null) })
    await expect(globalSwitch({ name: 'bk', type: 'bedrock-key', env: { CLAUDE_CODE_USE_BEDROCK: '1' } }, t.deps as any)).rejects.toThrow(/bedrock/i)
    expect(t.deps.saveSettings).not.toHaveBeenCalled()
    expect(t.deps.writeActive).not.toHaveBeenCalled()
  })

  it('bedrock sets aws env and neutralizes login', async () => {
    const t = baseDeps()
    await globalSwitch({ name: 'bd', type: 'bedrock', env: { CLAUDE_CODE_USE_BEDROCK: '1', AWS_PROFILE: 'p', AWS_REGION: 'us-east-1' } }, t.deps as any)
    expect(t.savedRef().env.CLAUDE_CODE_USE_BEDROCK).toBe('1')
    expect(t.savedRef().env.AWS_PROFILE).toBe('p')
    expect(t.deps.neutralizeLiveCredential).toHaveBeenCalled()
  })

  it('re-snapshots the outgoing login profile live credential before switching away', async () => {
    const t = baseDeps({
      readActive: vi.fn().mockReturnValue({ name: 'work', managedKeys: [] }),
      loadProfile: vi.fn().mockReturnValue({ name: 'work', type: 'login', env: {} }),
      readLiveCredential: vi.fn().mockResolvedValue('fresh-rotated-cred'),
    })
    await globalSwitch({ name: 'k', type: 'api-key', env: {} }, t.deps as any)
    expect(t.deps.setSecret).toHaveBeenCalledWith('work', 'fresh-rotated-cred', 'linux', t.paths)
    // and it must happen before we neutralize the live credential
    const setOrder = t.deps.setSecret.mock.invocationCallOrder[0]
    const neutralizeOrder = t.deps.neutralizeLiveCredential.mock.invocationCallOrder[0]
    expect(setOrder).toBeLessThan(neutralizeOrder)
  })

  it('does not re-snapshot when the outgoing profile is not a login profile', async () => {
    const t = baseDeps({
      readActive: vi.fn().mockReturnValue({ name: 'bd', managedKeys: [] }),
      loadProfile: vi.fn().mockReturnValue({ name: 'bd', type: 'bedrock', env: {} }),
      readLiveCredential: vi.fn().mockResolvedValue('should-not-be-read'),
    })
    await globalSwitch({ name: 'k', type: 'api-key', env: {} }, t.deps as any)
    expect(t.deps.setSecret).not.toHaveBeenCalled()
  })

  it('does not re-snapshot when no live credential is present for the outgoing login', async () => {
    const t = baseDeps({
      readActive: vi.fn().mockReturnValue({ name: 'work', managedKeys: [] }),
      loadProfile: vi.fn().mockReturnValue({ name: 'work', type: 'login', env: {} }),
      readLiveCredential: vi.fn().mockResolvedValue(null),
    })
    await globalSwitch({ name: 'k', type: 'api-key', env: {} }, t.deps as any)
    expect(t.deps.setSecret).not.toHaveBeenCalled()
  })

  it('clears keys managed by the previous profile', async () => {
    const t = baseDeps({ readActive: vi.fn().mockReturnValue({ name: 'old', managedKeys: ['env.CLAUDE_CODE_USE_BEDROCK'] }), loadSettings: vi.fn().mockReturnValue({ env: { CLAUDE_CODE_USE_BEDROCK: '1' } }) })
    await globalSwitch({ name: 'work', type: 'login', env: {} }, t.deps as any)
    expect(t.savedRef().env?.CLAUDE_CODE_USE_BEDROCK).toBeUndefined()
  })

  it('does not touch settings/active if writeLiveCredential (login) fails', async () => {
    const t = baseDeps({ writeLiveCredential: vi.fn().mockRejectedValue(new Error('keychain locked')) })
    await expect(globalSwitch({ name: 'work', type: 'login', env: {} }, t.deps as any)).rejects.toThrow('keychain locked')
    expect(t.deps.saveSettings).not.toHaveBeenCalled()
    expect(t.deps.writeActive).not.toHaveBeenCalled()
  })

  it('does not touch settings/active if neutralizeLiveCredential (api-key) fails', async () => {
    const t = baseDeps({ neutralizeLiveCredential: vi.fn().mockRejectedValue(new Error('keychain locked')) })
    await expect(globalSwitch({ name: 'k', type: 'api-key', env: {} }, t.deps as any)).rejects.toThrow('keychain locked')
    expect(t.deps.saveSettings).not.toHaveBeenCalled()
    expect(t.deps.writeActive).not.toHaveBeenCalled()
  })

  it('does not touch settings/active if neutralizeLiveCredential (bedrock) fails', async () => {
    const t = baseDeps({ neutralizeLiveCredential: vi.fn().mockRejectedValue(new Error('keychain locked')) })
    await expect(globalSwitch({ name: 'bd', type: 'bedrock', env: { CLAUDE_CODE_USE_BEDROCK: '1', AWS_PROFILE: 'p', AWS_REGION: 'us-east-1' } }, t.deps as any)).rejects.toThrow('keychain locked')
    expect(t.deps.saveSettings).not.toHaveBeenCalled()
    expect(t.deps.writeActive).not.toHaveBeenCalled()
  })

  it('gives an actionable error message if saveSettings fails after credential was applied', async () => {
    const t = baseDeps({ saveSettings: vi.fn().mockImplementation(() => { throw new Error('disk full') }) })
    await expect(globalSwitch({ name: 'work', type: 'login', env: {} }, t.deps as any)).rejects.toThrow(/backup|inconsistent|manual/i)
    expect(t.deps.writeLiveCredential).toHaveBeenCalled()
  })

  it('gives an actionable error message if writeActive fails after credential was applied', async () => {
    const t = baseDeps({ writeActive: vi.fn().mockImplementation(() => { throw new Error('disk full') }) })
    await expect(globalSwitch({ name: 'work', type: 'login', env: {} }, t.deps as any)).rejects.toThrow(/backup|inconsistent|manual/i)
    expect(t.deps.writeLiveCredential).toHaveBeenCalled()
  })
})
