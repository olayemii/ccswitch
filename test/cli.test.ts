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
afterEach(() => { process.stdout.write = origWrite })

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
