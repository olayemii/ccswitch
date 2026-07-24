import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runCli } from '../src/cli.js'

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
)

describe('cli smoke', () => {
  it('returns 0 for --version', async () => {
    const code = await runCli(['--version'])
    expect(code).toBe(0)
  })

  // The version was hardcoded once and silently desynced from package.json at
  // the 0.2.0 release — `ccswitch --version` reported 0.1.0. Pin them together.
  it('--version reports the package version', async () => {
    const out: string[] = []
    const orig = process.stdout.write
    process.stdout.write = ((s: string) => { out.push(String(s)); return true }) as any
    try {
      await runCli(['--version'])
    } finally {
      process.stdout.write = orig
    }
    expect(out.join('').trim()).toBe(pkg.version)
  })
})
