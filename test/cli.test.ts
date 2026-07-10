import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCli } from '../src/cli.js'
import { paths } from '../src/platform.js'
import { saveProfile } from '../src/profiles.js'

let home: string
let out: string[]
let origWrite: any

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ccs-home-'))
  process.env.HOME = home
  process.env.USERPROFILE = home
  delete process.env.CLAUDE_CONFIG_DIR
  out = []
  origWrite = process.stdout.write
  process.stdout.write = ((s: string) => { out.push(String(s)); return true }) as any
})
afterEach(() => {
  process.stdout.write = origWrite
})

describe('cli read commands', () => {
  it('list shows profiles and marks active', async () => {
    const p = paths(process.env, 'linux')
    saveProfile({ name: 'work', type: 'api-key', env: {} }, p)
    const code = await runCli(['list'], { platform: 'linux' })
    expect(code).toBe(0)
    expect(out.join('')).toContain('work')
  })

  it('current prints (none) when unset', async () => {
    const code = await runCli(['current'], { platform: 'linux' })
    expect(code).toBe(0)
    expect(out.join('')).toMatch(/none/i)
  })

  it('env --unset prints unset lines', async () => {
    const code = await runCli(['env', '--unset'], { platform: 'linux' })
    expect(code).toBe(0)
    expect(out.join('')).toContain('unset ANTHROPIC_API_KEY')
  })

  it('shellinit prints a ccuse function', async () => {
    const code = await runCli(['shellinit'], { platform: 'linux' })
    expect(code).toBe(0)
    expect(out.join('')).toContain('ccuse')
  })

  it('unknown profile switch errors with suggestion', async () => {
    const err: string[] = []
    const origErrWrite = process.stderr.write
    process.stderr.write = ((s: string) => { err.push(String(s)); return true }) as any
    try {
      const code = await runCli(['does-not-exist'], { platform: 'linux' })
      expect(code).toBe(1)
      expect(err.join('')).toContain('ccswitch list')
    } finally {
      process.stderr.write = origErrWrite
    }
  })
})

import { describe as d2, it as i2, expect as e2 } from 'vitest'
import { getSecret as getSec, setSecret as setSec } from '../src/secretStore.js'
import { loadProfile as loadProf } from '../src/profiles.js'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

function shortTermKey(amzDate: string, expiresSec: number): string {
  const url = 'https://bedrock-runtime.us-east-1.amazonaws.com/?X-Amz-Algorithm=AWS4-HMAC-SHA256'
    + `&X-Amz-Date=${amzDate}&X-Amz-Expires=${expiresSec}`
    + '&X-Amz-SignedHeaders=host&X-Amz-Signature=deadbeef'
  return 'bedrock-api-key-' + Buffer.from(url, 'utf8').toString('base64')
}

d2('cli save/token', () => {
  i2('save api-key stores secret from live settings env', async () => {
    const p = paths(process.env, 'linux')
    mkdirSync(dirname(p.settingsFile), { recursive: true })
    writeFileSync(p.settingsFile, JSON.stringify({ env: { ANTHROPIC_API_KEY: 'sk-live' } }))
    const code = await runCli(['save', 'work', '--type', 'api-key'], { platform: 'linux' })
    e2(code).toBe(0)
    e2(await getSec('work', 'linux', p)).toBe('sk-live')
    e2(loadProf('work', p).type).toBe('api-key')
  })

  i2('save bedrock-key snapshots the token from AWS_BEARER_TOKEN_BEDROCK env', async () => {
    const env = { ...process.env, AWS_BEARER_TOKEN_BEDROCK: 'brk-live', AWS_REGION: 'eu-west-1' }
    const p = paths(env, 'linux')
    const code = await runCli(['save', 'bprod', '--type', 'bedrock-key'], { platform: 'linux', env })
    e2(code).toBe(0)
    e2(await getSec('bprod', 'linux', p)).toBe('brk-live')
    const prof = loadProf('bprod', p)
    e2(prof.type).toBe('bedrock-key')
    e2(prof.env.CLAUDE_CODE_USE_BEDROCK).toBe('1')
    e2(prof.env.AWS_REGION).toBe('eu-west-1')
  })

  i2('save --type bedrock-key records credExpiresAt from a short-term token', async () => {
    const p = paths(process.env, 'linux')
    const token = shortTermKey('20260711T000000Z', 43200)
    const env = { ...process.env, AWS_BEARER_TOKEN_BEDROCK: token }
    const code = await runCli(['save', 'brk', '--type', 'bedrock-key'], { platform: 'linux', env })
    e2(code).toBe(0)
    e2(loadProf('brk', p).credExpiresAt).toBe('2026-07-11T12:00:00.000Z')
  })

  i2('save bedrock-key errors when AWS_BEARER_TOKEN_BEDROCK is unset', async () => {
    const env = { ...process.env }
    delete env.AWS_BEARER_TOKEN_BEDROCK
    const err: string[] = []
    const origErrWrite = process.stderr.write
    process.stderr.write = ((s: string) => { err.push(String(s)); return true }) as any
    try {
      const code = await runCli(['save', 'bprod', '--type', 'bedrock-key'], { platform: 'linux', env })
      e2(code).toBe(1)
      e2(err.join('')).toContain('AWS_BEARER_TOKEN_BEDROCK')
    } finally {
      process.stderr.write = origErrWrite
    }
  })

  i2('save login stores the credential hash on the profile', async () => {
    const p = paths(process.env, 'linux')
    mkdirSync(dirname(p.credentialsFile), { recursive: true })
    writeFileSync(p.credentialsFile, 'live-cred-blob')
    const code = await runCli(['save', 'personal', '--type', 'login'], { platform: 'linux' })
    e2(code).toBe(0)
    const { hashCredential } = await import('../src/fingerprint.js')
    e2(loadProf('personal', p).credHash).toBe(hashCredential('live-cred-blob'))
  })

  i2('save login rejects a duplicate credential without --force', async () => {
    const p = paths(process.env, 'linux')
    mkdirSync(dirname(p.credentialsFile), { recursive: true })
    writeFileSync(p.credentialsFile, 'live-cred-blob')
    await runCli(['save', 'personal', '--type', 'login'], { platform: 'linux' })

    const err: string[] = []
    const origErrWrite = process.stderr.write
    process.stderr.write = ((s: string) => { err.push(String(s)); return true }) as any
    try {
      const code = await runCli(['save', 'work', '--type', 'login'], { platform: 'linux' })
      e2(code).toBe(1)
      e2(err.join('')).toContain('personal')
    } finally {
      process.stderr.write = origErrWrite
    }
  })

  i2('save login allows a duplicate credential with --force', async () => {
    const p = paths(process.env, 'linux')
    mkdirSync(dirname(p.credentialsFile), { recursive: true })
    writeFileSync(p.credentialsFile, 'live-cred-blob')
    await runCli(['save', 'personal', '--type', 'login'], { platform: 'linux' })
    const code = await runCli(['save', 'work', '--type', 'login', '--force'], { platform: 'linux' })
    e2(code).toBe(0)
    e2(loadProf('work', p).type).toBe('login')
  })

  i2('help prints an overview of the auth types', async () => {
    const code = await runCli(['help'], { platform: 'linux' })
    e2(code).toBe(0)
    const printed = out.join('')
    e2(printed).toContain('bedrock-key')
    e2(printed).toContain('login')
    e2(printed).toContain('api-key')
  })

  i2('token requires an existing login profile', async () => {
    const code = await runCli(['token', 'nope'], { platform: 'linux' })
    e2(code).toBe(1)
  })

  i2('refresh replaces the token in place and updates credExpiresAt', async () => {
    const p = paths(process.env, 'linux')
    saveProfile({ name: 'brk', type: 'bedrock-key', env: { CLAUDE_CODE_USE_BEDROCK: '1' }, credExpiresAt: '2026-07-11T00:00:00.000Z' }, p)
    await setSec('brk', 'old-token', 'linux', p)
    const newToken = shortTermKey('20260712T000000Z', 43200)
    const code = await runCli(['refresh', 'brk', '--token', newToken], { platform: 'linux' })
    e2(code).toBe(0)
    const saved = loadProf('brk', p)
    e2(saved.credExpiresAt).toBe('2026-07-12T12:00:00.000Z')
    e2(saved.type).toBe('bedrock-key')            // profile not recreated
    e2(await getSec('brk', 'linux', p)).toBe(newToken)
  })

  i2('refresh rejects a non-bedrock-key profile', async () => {
    const p = paths(process.env, 'linux')
    saveProfile({ name: 'api', type: 'api-key', env: {} }, p)
    const code = await runCli(['refresh', 'api', '--token', 'x'], { platform: 'linux' })
    e2(code).toBe(1)                              // runCli returns 1 on thrown errors
  })

  i2('list shows EXPIRED badge for a bedrock-key profile past its expiry', async () => {
    const p = paths(process.env, 'linux')
    saveProfile({ name: 'brk', type: 'bedrock-key', env: {}, credExpiresAt: '2000-01-01T00:00:00.000Z' }, p)
    const code = await runCli(['list'], { platform: 'linux' })
    e2(code).toBe(0)
    e2(out.join('')).toMatch(/brk \(bedrock-key\).*EXPIRED/)
  })

  i2('save with an invalid (path-traversal) profile name is rejected', async () => {
    const err: string[] = []
    const origErrWrite = process.stderr.write
    process.stderr.write = ((s: string) => { err.push(String(s)); return true }) as any
    try {
      const code = await runCli(['save', '../evil', '--type', 'api-key'], { platform: 'linux' })
      e2(code).toBe(1)
      e2(err.join('')).toContain('Invalid profile name')
    } finally {
      process.stderr.write = origErrWrite
    }
  })

  i2('remove deletes both the secret and token slots', async () => {
    const p = paths(process.env, 'linux')
    saveProfile({ name: 'work', type: 'login', env: {}, hasToken: true }, p)
    await setSec('work', 'cred-value', 'linux', p)
    await setSec('work', 'token-value', 'linux', p, { slot: 'token' })
    e2(await getSec('work', 'linux', p)).toBe('cred-value')
    e2(await getSec('work', 'linux', p, { slot: 'token' })).toBe('token-value')

    const code = await runCli(['remove', 'work'], { platform: 'linux' })
    e2(code).toBe(0)
    e2(await getSec('work', 'linux', p)).toBeNull()
    e2(await getSec('work', 'linux', p, { slot: 'token' })).toBeNull()
  })

  i2('rename moves the profile, re-keys both secret slots, and clears the old ones', async () => {
    const p = paths(process.env, 'linux')
    saveProfile({ name: 'old', type: 'login', env: {}, hasToken: true }, p)
    await setSec('old', 'the-cred', 'linux', p)
    await setSec('old', 'the-token', 'linux', p, { slot: 'token' })

    const code = await runCli(['rename', 'old', 'new'], { platform: 'linux' })
    e2(code).toBe(0)
    e2(loadProf('new', p).type).toBe('login')
    e2(await getSec('new', 'linux', p)).toBe('the-cred')
    e2(await getSec('new', 'linux', p, { slot: 'token' })).toBe('the-token')
    e2(await getSec('old', 'linux', p)).toBeNull()
    e2(await getSec('old', 'linux', p, { slot: 'token' })).toBeNull()
  })

  i2('rename updates the active pointer when renaming the active profile', async () => {
    const p = paths(process.env, 'linux')
    saveProfile({ name: 'old', type: 'api-key', env: {} }, p)
    await setSec('old', 'sk', 'linux', p)
    mkdirSync(dirname(p.activeFile), { recursive: true })
    writeFileSync(p.activeFile, JSON.stringify({ name: 'old', managedKeys: ['apiKeyHelper'] }))
    const code = await runCli(['rename', 'old', 'new'], { platform: 'linux' })
    e2(code).toBe(0)
    const { readActive } = await import('../src/profiles.js')
    e2(readActive(p)?.name).toBe('new')
  })

  i2('rename rejects an existing target name', async () => {
    const p = paths(process.env, 'linux')
    saveProfile({ name: 'old', type: 'api-key', env: {} }, p)
    saveProfile({ name: 'taken', type: 'api-key', env: {} }, p)
    const err: string[] = []
    const origErrWrite = process.stderr.write
    process.stderr.write = ((s: string) => { err.push(String(s)); return true }) as any
    try {
      const code = await runCli(['rename', 'old', 'taken'], { platform: 'linux' })
      e2(code).toBe(1)
      e2(err.join('')).toContain('already exists')
    } finally {
      process.stderr.write = origErrWrite
    }
  })

  i2('doctor reports a clean bill for a healthy api-key profile', async () => {
    const p = paths(process.env, 'linux')
    saveProfile({ name: 'k', type: 'api-key', env: {} }, p)
    await setSec('k', 'sk-secret', 'linux', p)
    mkdirSync(dirname(p.settingsFile), { recursive: true })
    writeFileSync(p.settingsFile, JSON.stringify({ apiKeyHelper: "cat '/x'" }))
    writeFileSync(p.activeFile, JSON.stringify({ name: 'k', managedKeys: ['apiKeyHelper'] }))
    const code = await runCli(['doctor'], { platform: 'linux' })
    e2(code).toBe(0)
    e2(out.join('')).toContain('0 error(s)')
    e2(out.join('')).toContain('Active profile details:')
    e2(out.join('')).toContain('name:        k')
  })

  i2('doctor masks the secret in output and does not reveal the raw value', async () => {
    const p = paths(process.env, 'linux')
    saveProfile({ name: 'k', type: 'api-key', env: {} }, p)
    await setSec('k', 'sk-ant-SUPERSECRETVALUE-9999', 'linux', p)
    mkdirSync(dirname(p.settingsFile), { recursive: true })
    writeFileSync(p.settingsFile, JSON.stringify({ apiKeyHelper: "cat '/x'" }))
    writeFileSync(p.activeFile, JSON.stringify({ name: 'k', managedKeys: ['apiKeyHelper'] }))
    const code = await runCli(['doctor'], { platform: 'linux' })
    e2(code).toBe(0)
    const printed = out.join('')
    e2(printed).not.toContain('SUPERSECRETVALUE')
    e2(printed).toContain('credential:')
  })

  i2('doctor exits non-zero when the active pointer is stale', async () => {
    const p = paths(process.env, 'linux')
    mkdirSync(dirname(p.activeFile), { recursive: true })
    writeFileSync(p.activeFile, JSON.stringify({ name: 'ghost', managedKeys: [] }))
    const err: string[] = []
    const origErrWrite = process.stderr.write
    process.stderr.write = ((s: string) => { err.push(String(s)); return true }) as any
    try {
      const code = await runCli(['doctor'], { platform: 'linux' })
      e2(code).toBe(1)
      e2(out.join('')).toContain('ghost')
      e2(out.join('')).toContain('No active profile.')
    } finally {
      process.stderr.write = origErrWrite
    }
  })

  i2('env for a login profile reads the token slot, not the credential slot', async () => {
    const p = paths(process.env, 'linux')
    saveProfile({ name: 'work', type: 'login', env: {}, hasToken: true }, p)
    await setSec('work', 'the-credential', 'linux', p)
    await setSec('work', 'the-token', 'linux', p, { slot: 'token' })

    const code = await runCli(['env', 'work'], { platform: 'linux' })
    e2(code).toBe(0)
    const printed = out.join('')
    e2(printed).toContain('CLAUDE_CODE_OAUTH_TOKEN')
    e2(printed).toContain('the-token')
    e2(printed).not.toContain('the-credential')
  })
})
