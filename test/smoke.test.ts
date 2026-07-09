import { describe, it, expect } from 'vitest'
import { runCli } from '../src/cli.js'

describe('cli smoke', () => {
  it('returns 0 for --version', async () => {
    const code = await runCli(['--version'])
    expect(code).toBe(0)
  })
})
