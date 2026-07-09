import { describe, it, expect } from 'vitest'
import { paths, usesKeychain } from '../src/platform.js'
import path from 'node:path'

describe('paths', () => {
  const env = { HOME: '/home/u' } as NodeJS.ProcessEnv

  it('places ccswitch dir under home', () => {
    const p = paths(env, 'linux')
    expect(p.ccswitchDir).toBe(path.join('/home/u', '.ccswitch'))
    expect(p.profilesDir).toBe(path.join('/home/u', '.ccswitch', 'profiles'))
  })

  it('defaults claude config dir to ~/.claude', () => {
    const p = paths(env, 'linux')
    expect(p.claudeConfigDir).toBe(path.join('/home/u', '.claude'))
    expect(p.settingsFile).toBe(path.join('/home/u', '.claude', 'settings.json'))
  })

  it('honors CLAUDE_CONFIG_DIR override', () => {
    const p = paths({ HOME: '/home/u', CLAUDE_CONFIG_DIR: '/custom' }, 'linux')
    expect(p.settingsFile).toBe(path.join('/custom', 'settings.json'))
    expect(p.credentialsFile).toBe(path.join('/custom', '.credentials.json'))
  })

  it('keychain only on darwin', () => {
    expect(usesKeychain('darwin')).toBe(true)
    expect(usesKeychain('linux')).toBe(false)
    expect(usesKeychain('win32')).toBe(false)
  })
})
