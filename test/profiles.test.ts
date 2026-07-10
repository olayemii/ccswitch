import { describe, it, expect } from 'vitest'
import { saveProfile, loadProfile, listProfiles, removeProfile, profileExists, readActive, writeActive, assertValidProfileName } from '../src/profiles.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Paths } from '../src/platform.js'

function tmpPaths(): Paths {
  const dir = mkdtempSync(join(tmpdir(), 'ccs-'))
  return {
    ccswitchDir: dir, profilesDir: join(dir, 'profiles'), secretsDir: join(dir, 'secrets'),
    homesDir: join(dir, 'homes'), activeFile: join(dir, 'active.json'),
    claudeConfigDir: dir, settingsFile: join(dir, 's.json'), credentialsFile: join(dir, 'c.json'),
    claudeJsonFile: join(dir, 'j.json'),
  }
}

describe('profiles', () => {
  it('saves and loads a profile', () => {
    const p = tmpPaths()
    saveProfile({ name: 'work', type: 'api-key', env: {} }, p)
    expect(loadProfile('work', p).type).toBe('api-key')
    expect(profileExists('work', p)).toBe(true)
  })

  it('throws on unknown profile', () => {
    const p = tmpPaths()
    expect(() => loadProfile('nope', p)).toThrow('Unknown profile: nope')
  })

  it('lists profiles sorted, empty when none', () => {
    const p = tmpPaths()
    expect(listProfiles(p)).toEqual([])
    saveProfile({ name: 'b', type: 'login', env: {} }, p)
    saveProfile({ name: 'a', type: 'login', env: {} }, p)
    expect(listProfiles(p).map((x) => x.name)).toEqual(['a', 'b'])
  })

  it('removes a profile', () => {
    const p = tmpPaths()
    saveProfile({ name: 'x', type: 'login', env: {} }, p)
    removeProfile('x', p)
    expect(profileExists('x', p)).toBe(false)
  })

  it('reads null active when unset, round-trips active', () => {
    const p = tmpPaths()
    expect(readActive(p)).toBeNull()
    writeActive({ name: 'work', managedKeys: ['env.ANTHROPIC_API_KEY'] }, p)
    expect(readActive(p)).toEqual({ name: 'work', managedKeys: ['env.ANTHROPIC_API_KEY'] })
  })
})

describe('assertValidProfileName', () => {
  it('accepts valid names', () => {
    expect(() => assertValidProfileName('work')).not.toThrow()
    expect(() => assertValidProfileName('my.profile')).not.toThrow()
    expect(() => assertValidProfileName('a-b_c')).not.toThrow()
  })

  it('rejects invalid names', () => {
    for (const bad of ['', '.', '..', '../x', 'a/b', 'a b', "a'b"]) {
      expect(() => assertValidProfileName(bad)).toThrow(/Invalid profile name/)
    }
  })
})
