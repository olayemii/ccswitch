import { describe, it, expect } from 'vitest'
import { hashCredential, findDuplicateLoginName } from '../src/fingerprint.js'
import type { Profile } from '../src/types.js'

describe('hashCredential', () => {
  it('is stable and hex-encoded for the same input', () => {
    const a = hashCredential('the-credential-blob')
    const b = hashCredential('the-credential-blob')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('differs for different inputs', () => {
    expect(hashCredential('acct-a')).not.toBe(hashCredential('acct-b'))
  })
})

describe('findDuplicateLoginName', () => {
  const login = (name: string, credHash?: string): Profile => ({ name, type: 'login', env: {}, credHash })

  it('finds another login profile with the same hash', () => {
    const h = hashCredential('same')
    const profiles = [login('personal', h), login('work', hashCredential('other'))]
    expect(findDuplicateLoginName(h, profiles, 'newone')).toBe('personal')
  })

  it('excludes the profile being (re)saved', () => {
    const h = hashCredential('same')
    const profiles = [login('personal', h)]
    expect(findDuplicateLoginName(h, profiles, 'personal')).toBeNull()
  })

  it('ignores non-login profiles and profiles without credHash', () => {
    const h = hashCredential('same')
    const profiles: Profile[] = [
      { name: 'legacy', type: 'login', env: {} },
      { name: 'apikey', type: 'api-key', env: {}, credHash: h } as Profile,
    ]
    expect(findDuplicateLoginName(h, profiles, 'newone')).toBeNull()
  })
})
