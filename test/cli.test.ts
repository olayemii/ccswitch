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
// cli.ts derives its platform from process.platform via getPlatform(); these tests build
// expected paths/secrets against a fixed 'linux' target, so pin the host platform here to
// keep results deterministic across dev machines (e.g. running this suite on macOS).
const origPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!

beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
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
  Object.defineProperty(process, 'platform', origPlatformDescriptor)
})

describe('cli read commands', () => {
  it('list shows profiles and marks active', async () => {
    const p = paths(process.env, 'linux')
    saveProfile({ name: 'work', type: 'api-key', env: {} }, p)
    const code = await runCli(['list'])
    expect(code).toBe(0)
    expect(out.join('')).toContain('work')
  })

  it('current prints (none) when unset', async () => {
    const code = await runCli(['current'])
    expect(code).toBe(0)
    expect(out.join('')).toMatch(/none/i)
  })

  it('env --unset prints unset lines', async () => {
    const code = await runCli(['env', '--unset'])
    expect(code).toBe(0)
    expect(out.join('')).toContain('unset ANTHROPIC_API_KEY')
  })

  it('shellinit prints a ccuse function', async () => {
    const code = await runCli(['shellinit'])
    expect(code).toBe(0)
    expect(out.join('')).toContain('ccuse')
  })

  it('unknown profile switch errors with suggestion', async () => {
    const err: string[] = []
    const origErrWrite = process.stderr.write
    process.stderr.write = ((s: string) => { err.push(String(s)); return true }) as any
    try {
      const code = await runCli(['does-not-exist'])
      expect(code).toBe(1)
      expect(err.join('')).toContain('ccswitch list')
    } finally {
      process.stderr.write = origErrWrite
    }
  })
})

import { describe as d2, it as i2, expect as e2 } from 'vitest'
import { getSecret as getSec } from '../src/secretStore.js'
import { loadProfile as loadProf } from '../src/profiles.js'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

d2('cli save/token', () => {
  i2('save api-key stores secret from live settings env', async () => {
    const p = paths(process.env, 'linux')
    mkdirSync(dirname(p.settingsFile), { recursive: true })
    writeFileSync(p.settingsFile, JSON.stringify({ env: { ANTHROPIC_API_KEY: 'sk-live' } }))
    const code = await runCli(['save', 'work', '--type', 'api-key'])
    e2(code).toBe(0)
    e2(await getSec('work', 'linux', p)).toBe('sk-live')
    e2(loadProf('work', p).type).toBe('api-key')
  })

  i2('token requires an existing login profile', async () => {
    const code = await runCli(['token', 'nope'])
    e2(code).toBe(1)
  })
})
