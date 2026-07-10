import { describe, it, expect } from 'vitest'
import { diagnose, maskSecret, describeActive, type DoctorSnapshot, type Finding } from '../src/doctor.js'
import type { Profile } from '../src/types.js'

const now = new Date('2026-07-10T00:00:00Z')

function snap(overrides: Partial<DoctorSnapshot> = {}): DoctorSnapshot {
  return {
    profiles: [],
    active: null,
    settings: {},
    liveCredentialPresent: false,
    profileStates: {},
    now,
    ...overrides,
  }
}
const errors = (fs: Finding[]) => fs.filter((f) => f.level === 'error')
const warns = (fs: Finding[]) => fs.filter((f) => f.level === 'warn')

describe('diagnose', () => {
  it('reports no active pointer as ok', () => {
    const fs = diagnose(snap())
    expect(errors(fs)).toHaveLength(0)
    expect(fs.some((f) => /nothing has been switched/.test(f.message))).toBe(true)
  })

  it('flags a stale active pointer to a missing profile as an error', () => {
    const fs = diagnose(snap({ active: { name: 'ghost', managedKeys: [] } }))
    expect(errors(fs).some((f) => f.message.includes('ghost'))).toBe(true)
  })

  it('flags an active api-key profile with no apiKeyHelper in settings', () => {
    const profile: Profile = { name: 'k', type: 'api-key', env: {} }
    const fs = diagnose(snap({
      profiles: [profile],
      active: { name: 'k', managedKeys: ['apiKeyHelper'] },
      settings: {},
      profileStates: { k: { hasSecret: true, hasToken: false, configDirExists: false } },
    }))
    expect(errors(fs).some((f) => /apiKeyHelper/.test(f.message))).toBe(true)
  })

  it('passes a healthy active api-key profile', () => {
    const profile: Profile = { name: 'k', type: 'api-key', env: {} }
    const fs = diagnose(snap({
      profiles: [profile],
      active: { name: 'k', managedKeys: ['apiKeyHelper'] },
      settings: { apiKeyHelper: "cat '/secrets/k'" },
      profileStates: { k: { hasSecret: true, hasToken: false, configDirExists: false } },
    }))
    expect(errors(fs)).toHaveLength(0)
  })

  it('flags an active login profile with a lingering apiKeyHelper', () => {
    const profile: Profile = { name: 'work', type: 'login', env: {} }
    const fs = diagnose(snap({
      profiles: [profile],
      active: { name: 'work', managedKeys: [] },
      settings: { apiKeyHelper: 'cat x' },
      liveCredentialPresent: true,
      profileStates: { work: { hasSecret: true, hasToken: false, configDirExists: false } },
    }))
    expect(warns(fs).some((f) => /apiKeyHelper/.test(f.message))).toBe(true)
  })

  it('warns when the active login profile has no live credential', () => {
    const profile: Profile = { name: 'work', type: 'login', env: {} }
    const fs = diagnose(snap({
      profiles: [profile],
      active: { name: 'work', managedKeys: [] },
      settings: {},
      liveCredentialPresent: false,
      profileStates: { work: { hasSecret: true, hasToken: false, configDirExists: false } },
    }))
    expect(warns(fs).some((f) => /no live credential/.test(f.message))).toBe(true)
  })

  it('flags an active bedrock-key profile missing the bearer token in settings', () => {
    const profile: Profile = { name: 'bk', type: 'bedrock-key', env: { CLAUDE_CODE_USE_BEDROCK: '1' } }
    const fs = diagnose(snap({
      profiles: [profile],
      active: { name: 'bk', managedKeys: ['env.AWS_BEARER_TOKEN_BEDROCK'] },
      settings: { env: { CLAUDE_CODE_USE_BEDROCK: '1' } },
      profileStates: { bk: { hasSecret: true, hasToken: false, configDirExists: false } },
    }))
    expect(errors(fs).some((f) => /AWS_BEARER_TOKEN_BEDROCK/.test(f.message))).toBe(true)
  })

  it('flags a login profile marked hasToken but with no token stored', () => {
    const profile: Profile = { name: 'work', type: 'login', env: {}, hasToken: true }
    const fs = diagnose(snap({
      profiles: [profile],
      profileStates: { work: { hasSecret: true, hasToken: false, configDirExists: false } },
    }))
    expect(errors(fs).some((f) => /no token is stored/.test(f.message))).toBe(true)
  })

  it('errors when an api-key profile has no stored secret', () => {
    const profile: Profile = { name: 'k', type: 'api-key', env: {} }
    const fs = diagnose(snap({
      profiles: [profile],
      profileStates: { k: { hasSecret: false, hasToken: false, configDirExists: false } },
    }))
    expect(errors(fs).some((f) => /no stored secret/.test(f.message))).toBe(true)
  })

  it('warns when an isolated config dir is missing', () => {
    const profile: Profile = { name: 'work', type: 'login', env: {}, configDir: '/homes/work' }
    const fs = diagnose(snap({
      profiles: [profile],
      profileStates: { work: { hasSecret: true, hasToken: false, configDirExists: false } },
    }))
    expect(warns(fs).some((f) => /isolated config dir/.test(f.message))).toBe(true)
  })

  it('warns on a stale captured token', () => {
    const old = new Date(now.getTime() - 320 * 24 * 60 * 60 * 1000).toISOString()
    const profile: Profile = { name: 'work', type: 'login', env: {}, hasToken: true, tokenCapturedAt: old }
    const fs = diagnose(snap({
      profiles: [profile],
      profileStates: { work: { hasSecret: true, hasToken: true, configDirExists: false } },
    }))
    expect(warns(fs).some((f) => /may have expired/.test(f.message))).toBe(true)
  })
})

describe('maskSecret', () => {
  it('shows first 6 and last 4 with length for long secrets', () => {
    expect(maskSecret('sk-ant-api03-abcdefghij-a3f9')).toBe('sk-ant…a3f9 (len 28)')
  })
  it('shows only last 4 with length for short secrets', () => {
    expect(maskSecret('abcdef')).toBe('…cdef (len 6)')
  })
  it('returns (none) for empty string', () => {
    expect(maskSecret('')).toBe('(none)')
  })
  it('returns (none) for null or undefined', () => {
    expect(maskSecret(null)).toBe('(none)')
    expect(maskSecret(undefined)).toBe('(none)')
  })
})

describe('describeActive', () => {
  it('returns a single line when there is no active profile', () => {
    expect(describeActive(snap())).toEqual(['No active profile.'])
  })

  it('returns the no-active line when the active pointer references a missing profile', () => {
    expect(describeActive(snap({ active: { name: 'ghost', managedKeys: [] } }))).toEqual(['No active profile.'])
  })

  it('shows a masked credential for an active api-key profile', () => {
    const profile: Profile = { name: 'k', type: 'api-key', env: {} }
    const lines = describeActive(snap({
      profiles: [profile],
      active: { name: 'k', managedKeys: ['apiKeyHelper'] },
      profileStates: { k: { hasSecret: true, hasToken: false, configDirExists: false, secretPreview: 'sk-ant-api03-xyz-a3f9' } },
    }))
    expect(lines.join('\n')).toContain('credential:  sk-ant…a3f9 (len 21)')
    expect(lines.join('\n')).not.toContain('account:')
  })

  it('describes a bedrock profile with name, type and default config dir', () => {
    const profile: Profile = { name: 'br', type: 'bedrock', env: { CLAUDE_CODE_USE_BEDROCK: '1' } }
    const lines = describeActive(snap({
      profiles: [profile],
      active: { name: 'br', managedKeys: [] },
      profileStates: { br: { hasSecret: false, hasToken: false, configDirExists: false } },
    }))
    expect(lines[0]).toBe('Active profile details:')
    expect(lines.join('\n')).toContain('name:        br')
    expect(lines.join('\n')).toContain('type:        bedrock')
    expect(lines.join('\n')).toContain('config dir:  (default)')
    expect(lines.join('\n')).not.toContain('credential:')
    expect(lines.join('\n')).not.toContain('account:')
  })
})
