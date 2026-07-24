import { describe, it, expect, vi } from 'vitest'
import { globalSwitch } from '../src/switch.js'
import type { Paths } from '../src/platform.js'

function baseDeps(overrides = {}) {
  const paths = { ccswitchDir: '/cc', profilesDir: '/cc/profiles', secretsDir: '/cc/secrets', homesDir: '/cc/homes', activeFile: '/cc/active.json', claudeConfigDir: '/cl', settingsFile: '/cl/settings.json', credentialsFile: '/cl/.credentials.json', claudeJsonFile: '/cl/.claude.json' } as Paths
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
      readOAuthAccount: vi.fn().mockReturnValue(null),
      writeOAuthAccount: vi.fn(),
      saveProfile: vi.fn(),
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

  it('custom injects ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN, marks them managed, and neutralizes login', async () => {
    const t = baseDeps({ getSecret: vi.fn().mockResolvedValue('sk-ds') })
    await globalSwitch(
      { name: 'ds', type: 'custom', env: { ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic', ANTHROPIC_MODEL: 'deepseek-v4-pro' } },
      t.deps as any,
    )
    expect(t.savedRef().env.ANTHROPIC_BASE_URL).toBe('https://api.deepseek.com/anthropic')
    expect(t.savedRef().env.ANTHROPIC_AUTH_TOKEN).toBe('sk-ds')
    expect(t.savedRef().env.ANTHROPIC_MODEL).toBe('deepseek-v4-pro')
    expect(t.deps.neutralizeLiveCredential).toHaveBeenCalled()
    expect(t.deps.writeActive).toHaveBeenCalledWith(
      { name: 'ds', managedKeys: expect.arrayContaining(['env.ANTHROPIC_BASE_URL', 'env.ANTHROPIC_AUTH_TOKEN', 'env.ANTHROPIC_MODEL']) },
      t.paths,
    )
  })

  it('custom throws when no token is stored and does not touch settings', async () => {
    const t = baseDeps({ getSecret: vi.fn().mockResolvedValue(null) })
    await expect(globalSwitch({ name: 'ds', type: 'custom', env: { ANTHROPIC_BASE_URL: 'https://x' } }, t.deps as any)).rejects.toThrow(/token/i)
    expect(t.deps.saveSettings).not.toHaveBeenCalled()
    expect(t.deps.writeActive).not.toHaveBeenCalled()
  })

  it('switching from a custom endpoint to a login clears its base url, token and model overrides', async () => {
    const t = baseDeps({
      readActive: vi.fn().mockReturnValue({ name: 'ds', managedKeys: ['env.ANTHROPIC_BASE_URL', 'env.ANTHROPIC_AUTH_TOKEN', 'env.ANTHROPIC_MODEL'] }),
      loadProfile: vi.fn().mockReturnValue({ name: 'ds', type: 'custom', env: { ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic' } }),
      loadSettings: vi.fn().mockReturnValue({ env: { ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic', ANTHROPIC_AUTH_TOKEN: 'sk-ds', ANTHROPIC_MODEL: 'deepseek-v4-pro' } }),
    })
    await globalSwitch({ name: 'work', type: 'login', env: {} }, t.deps as any)
    expect(t.savedRef().env?.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(t.savedRef().env?.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(t.savedRef().env?.ANTHROPIC_MODEL).toBeUndefined()
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

  it('does not throw when the outgoing profile no longer exists (stale active.json)', async () => {
    const t = baseDeps({
      readActive: vi.fn().mockReturnValue({ name: 'scholastic-main-api', managedKeys: [] }),
      loadProfile: vi.fn().mockImplementation(() => { throw new Error('Unknown profile: scholastic-main-api') }),
    })
    const result = await globalSwitch({ name: 'scholastic-bedrock', type: 'bedrock', env: {} }, t.deps as any)
    expect(result).toEqual({ warning: undefined })
    expect(t.deps.setSecret).not.toHaveBeenCalled()
    expect(t.deps.writeActive).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'scholastic-bedrock' }),
      t.paths,
    )
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

  it('warns when switching from bedrock to non-bedrock profile', async () => {
    const t = baseDeps({
      readActive: vi.fn().mockReturnValue({ name: 'bedrock-prof', managedKeys: ['env.CLAUDE_CODE_USE_BEDROCK'] }),
      loadProfile: vi.fn().mockReturnValue({ name: 'bedrock-prof', type: 'bedrock', env: { CLAUDE_CODE_USE_BEDROCK: '1' } }),
    })
    const result = await globalSwitch({ name: 'work', type: 'login', env: {} }, t.deps as any)
    expect(result.warning).toContain('CLAUDE_CODE_USE_BEDROCK')
    expect(result.warning).toContain('Open a new terminal')
  })

  it('warns when switching from bedrock-key to non-bedrock profile', async () => {
    const t = baseDeps({
      readActive: vi.fn().mockReturnValue({ name: 'bedrock-key-prof', managedKeys: ['env.AWS_BEARER_TOKEN_BEDROCK'] }),
      loadProfile: vi.fn().mockReturnValue({ name: 'bedrock-key-prof', type: 'bedrock-key', env: { CLAUDE_CODE_USE_BEDROCK: '1' } }),
    })
    const result = await globalSwitch({ name: 'api-prof', type: 'api-key', env: {} }, t.deps as any)
    expect(result.warning).toContain('Bedrock profile')
  })

  it('does not warn when switching from bedrock to bedrock', async () => {
    const t = baseDeps({
      readActive: vi.fn().mockReturnValue({ name: 'bedrock-prof', managedKeys: ['env.CLAUDE_CODE_USE_BEDROCK'] }),
      loadProfile: vi.fn().mockReturnValue({ name: 'bedrock-prof', type: 'bedrock', env: { CLAUDE_CODE_USE_BEDROCK: '1' } }),
    })
    const result = await globalSwitch({ name: 'other-bedrock', type: 'bedrock', env: { CLAUDE_CODE_USE_BEDROCK: '1' } }, t.deps as any)
    expect(result.warning).toBeUndefined()
  })

  it('applies the stored oauthAccount when switching to a login profile', async () => {
    const t = baseDeps()
    const account = { emailAddress: 'olayemii@example.com' }
    await globalSwitch({ name: 'work', type: 'login', env: {}, oauthAccount: account }, t.deps as any)
    expect(t.deps.writeOAuthAccount).toHaveBeenCalledWith(t.paths, account)
  })

  it('does not touch oauthAccount when the login profile has none stored', async () => {
    const t = baseDeps()
    await globalSwitch({ name: 'work', type: 'login', env: {} }, t.deps as any)
    expect(t.deps.writeOAuthAccount).not.toHaveBeenCalled()
  })

  it('does not apply oauthAccount for non-login profile switches', async () => {
    const t = baseDeps()
    await globalSwitch({ name: 'k', type: 'api-key', env: {} }, t.deps as any)
    expect(t.deps.writeOAuthAccount).not.toHaveBeenCalled()
  })

  it('re-snapshots the outgoing login profile oauthAccount before switching away', async () => {
    const outgoing = { name: 'work', type: 'login' as const, env: {} }
    const liveAccount = { emailAddress: 'fresh@example.com' }
    const t = baseDeps({
      readActive: vi.fn().mockReturnValue({ name: 'work', managedKeys: [] }),
      loadProfile: vi.fn().mockReturnValue(outgoing),
      readLiveCredential: vi.fn().mockResolvedValue('fresh-rotated-cred'),
      readOAuthAccount: vi.fn().mockReturnValue(liveAccount),
    })
    await globalSwitch({ name: 'k', type: 'api-key', env: {} }, t.deps as any)
    expect(t.deps.saveProfile).toHaveBeenCalledWith({ ...outgoing, oauthAccount: liveAccount }, t.paths)
  })

  it('does not re-snapshot oauthAccount when no live oauthAccount is present', async () => {
    const t = baseDeps({
      readActive: vi.fn().mockReturnValue({ name: 'work', managedKeys: [] }),
      loadProfile: vi.fn().mockReturnValue({ name: 'work', type: 'login', env: {} }),
      readLiveCredential: vi.fn().mockResolvedValue('fresh-rotated-cred'),
      readOAuthAccount: vi.fn().mockReturnValue(null),
    })
    await globalSwitch({ name: 'k', type: 'api-key', env: {} }, t.deps as any)
    expect(t.deps.saveProfile).not.toHaveBeenCalled()
  })

  it('warns that isolation is per-shell-only when switching to an isolated profile', async () => {
    const t = baseDeps()
    const result = await globalSwitch({ name: 'work', type: 'login', env: {}, configDir: '/cc/homes/work' }, t.deps as any)
    expect(result.warning).toMatch(/isolat/i)
    expect(result.warning).toContain('ccuse')
  })

  it('does not warn about isolation for a non-isolated profile', async () => {
    const t = baseDeps()
    const result = await globalSwitch({ name: 'work', type: 'login', env: {} }, t.deps as any)
    expect(result.warning).toBeUndefined()
  })

  it('combines the bedrock and isolation warnings when both apply', async () => {
    const t = baseDeps({
      readActive: vi.fn().mockReturnValue({ name: 'bd', managedKeys: ['env.CLAUDE_CODE_USE_BEDROCK'] }),
      loadProfile: vi.fn().mockReturnValue({ name: 'bd', type: 'bedrock', env: { CLAUDE_CODE_USE_BEDROCK: '1' } }),
    })
    const result = await globalSwitch({ name: 'work', type: 'login', env: {}, configDir: '/cc/homes/work' }, t.deps as any)
    expect(result.warning).toContain('CLAUDE_CODE_USE_BEDROCK')
    expect(result.warning).toMatch(/isolat/i)
  })

  it('does not warn when switching from login to bedrock', async () => {
    const t = baseDeps({
      readActive: vi.fn().mockReturnValue({ name: 'login-prof', managedKeys: [] }),
      loadProfile: vi.fn().mockReturnValue({ name: 'login-prof', type: 'login', env: {} }),
      readLiveCredential: vi.fn().mockResolvedValue('cred'),
    })
    const result = await globalSwitch({ name: 'bedrock-prof', type: 'bedrock', env: { CLAUDE_CODE_USE_BEDROCK: '1' } }, t.deps as any)
    expect(result.warning).toBeUndefined()
  })
})
