import { describe, it, expect } from 'vitest'
import { run } from '../src/exec.js'

describe('run', () => {
  it('captures stdout and code 0', async () => {
    const r = await run('node', ['-e', "process.stdout.write('hi')"])
    expect(r.stdout).toBe('hi')
    expect(r.code).toBe(0)
  })
  it('returns non-zero code without throwing', async () => {
    const r = await run('node', ['-e', 'process.exit(3)'])
    expect(r.code).toBe(3)
  })
  it('passes stdin input', async () => {
    const r = await run('node', ['-e', 'process.stdin.pipe(process.stdout)'], { input: 'abc' })
    expect(r.stdout).toBe('abc')
  })
})
