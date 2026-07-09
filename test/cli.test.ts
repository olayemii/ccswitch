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
