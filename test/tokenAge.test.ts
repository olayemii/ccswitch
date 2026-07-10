import { describe, it, expect } from 'vitest'
import { tokenAgeDays, tokenStaleWarning, TOKEN_STALE_DAYS } from '../src/tokenAge.js'
import type { Profile } from '../src/types.js'

const now = new Date('2026-07-10T00:00:00Z')
function daysAgo(d: number): string {
  return new Date(now.getTime() - d * 24 * 60 * 60 * 1000).toISOString()
}
function login(overrides: Partial<Profile> = {}): Profile {
  return { name: 'work', type: 'login', env: {}, ...overrides }
}

describe('tokenAgeDays', () => {
  it('returns null when the profile has no captured token', () => {
    expect(tokenAgeDays(login(), now)).toBeNull()
  })

  it('returns null when hasToken is set but no timestamp recorded (legacy profile)', () => {
    expect(tokenAgeDays(login({ hasToken: true }), now)).toBeNull()
  })

  it('returns null for an unparseable timestamp', () => {
    expect(tokenAgeDays(login({ hasToken: true, tokenCapturedAt: 'not-a-date' }), now)).toBeNull()
  })

  it('computes whole days since capture', () => {
    expect(tokenAgeDays(login({ hasToken: true, tokenCapturedAt: daysAgo(10) }), now)).toBe(10)
  })
})

describe('tokenStaleWarning', () => {
  it('is null for a fresh token', () => {
    expect(tokenStaleWarning(login({ hasToken: true, tokenCapturedAt: daysAgo(10) }), now)).toBeNull()
  })

  it('is null right below the threshold', () => {
    expect(tokenStaleWarning(login({ hasToken: true, tokenCapturedAt: daysAgo(TOKEN_STALE_DAYS - 1) }), now)).toBeNull()
  })

  it('warns at the threshold, naming the profile and the re-capture command', () => {
    const w = tokenStaleWarning(login({ hasToken: true, tokenCapturedAt: daysAgo(TOKEN_STALE_DAYS) }), now)
    expect(w).toContain('work')
    expect(w).toContain('ccswitch token work')
  })

  it('is null for a profile without a captured token', () => {
    expect(tokenStaleWarning(login(), now)).toBeNull()
  })
})
