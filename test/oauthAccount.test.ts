import { describe, it, expect } from 'vitest'
import { readOAuthAccount, writeOAuthAccount } from '../src/oauthAccount.js'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Paths } from '../src/platform.js'

function tmpPaths(): Paths {
  const dir = mkdtempSync(join(tmpdir(), 'ccs-'))
  return {
    ccswitchDir: dir, profilesDir: join(dir, 'profiles'), secretsDir: join(dir, 'secrets'),
    homesDir: join(dir, 'homes'), activeFile: join(dir, 'active.json'),
    claudeConfigDir: dir, settingsFile: join(dir, 's.json'), credentialsFile: join(dir, 'c.json'),
    claudeJsonFile: join(dir, '.claude.json'),
  }
}

describe('readOAuthAccount', () => {
  it('returns null when the file does not exist', () => {
    const p = tmpPaths()
    expect(readOAuthAccount(p)).toBeNull()
  })

  it('returns null when the key is absent', () => {
    const p = tmpPaths()
    writeFileSync(p.claudeJsonFile, JSON.stringify({ numStartups: 3 }))
    expect(readOAuthAccount(p)).toBeNull()
  })

  it('returns null when the file is unparseable', () => {
    const p = tmpPaths()
    writeFileSync(p.claudeJsonFile, 'not json')
    expect(readOAuthAccount(p)).toBeNull()
  })

  it('returns the oauthAccount value when present', () => {
    const p = tmpPaths()
    writeFileSync(p.claudeJsonFile, JSON.stringify({ numStartups: 3, oauthAccount: { emailAddress: 'a@b.com' } }))
    expect(readOAuthAccount(p)).toEqual({ emailAddress: 'a@b.com' })
  })
})

describe('writeOAuthAccount', () => {
  it('is a no-op when the file does not exist', () => {
    const p = tmpPaths()
    writeOAuthAccount(p, { emailAddress: 'a@b.com' })
    expect(existsSync(p.claudeJsonFile)).toBe(false)
  })

  it('sets oauthAccount while preserving every other key', () => {
    const p = tmpPaths()
    const original = { numStartups: 3, projects: { foo: 1 }, oauthAccount: { emailAddress: 'old@b.com' } }
    writeFileSync(p.claudeJsonFile, JSON.stringify(original))
    writeOAuthAccount(p, { emailAddress: 'new@b.com' })
    const result = JSON.parse(readFileSync(p.claudeJsonFile, 'utf8'))
    expect(result).toEqual({ numStartups: 3, projects: { foo: 1 }, oauthAccount: { emailAddress: 'new@b.com' } })
  })

  it('does not corrupt the file if it is unparseable', () => {
    const p = tmpPaths()
    writeFileSync(p.claudeJsonFile, 'not json')
    writeOAuthAccount(p, { emailAddress: 'new@b.com' })
    expect(readFileSync(p.claudeJsonFile, 'utf8')).toBe('not json')
  })

  it('writes atomically leaving no leftover temp file', () => {
    const p = tmpPaths()
    writeFileSync(p.claudeJsonFile, JSON.stringify({ numStartups: 1 }))
    writeOAuthAccount(p, { emailAddress: 'a@b.com' })
    const { readdirSync } = require('node:fs')
    const files = readdirSync(p.claudeConfigDir)
    expect(files).toEqual(['.claude.json'])
  })
})
