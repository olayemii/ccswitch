import { describe, it, expect } from 'vitest'
import { parseModelOverrides, pickModelOverrides } from '../src/cli.js'

describe('parseModelOverrides', () => {
  it('parses known model keys', () => {
    const out = parseModelOverrides('ANTHROPIC_MODEL=deepseek-v4-pro, ANTHROPIC_DEFAULT_HAIKU_MODEL=deepseek-v4-flash')
    expect(out).toEqual({
      ANTHROPIC_MODEL: 'deepseek-v4-pro',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-v4-flash',
    })
  })

  it('ignores blank segments', () => {
    expect(parseModelOverrides('ANTHROPIC_MODEL=x, ,')).toEqual({ ANTHROPIC_MODEL: 'x' })
  })

  it('rejects an unknown key so a typo cannot inject arbitrary settings', () => {
    expect(() => parseModelOverrides('ANTHROPIC_BASE_URL=https://evil')).toThrow(/Unknown model key/)
    expect(() => parseModelOverrides('FOO=bar')).toThrow(/Unknown model key/)
  })

  it('rejects a segment without =', () => {
    expect(() => parseModelOverrides('ANTHROPIC_MODEL')).toThrow(/KEY=value/)
  })
})

describe('pickModelOverrides', () => {
  it('keeps only recognized model keys and drops everything else', () => {
    const out = pickModelOverrides({
      ANTHROPIC_MODEL: 'm',
      ANTHROPIC_BASE_URL: 'https://x',
      ANTHROPIC_AUTH_TOKEN: 'sk',
      SOMETHING: 'else',
      ANTHROPIC_DEFAULT_OPUS_MODEL: '',
    })
    expect(out).toEqual({ ANTHROPIC_MODEL: 'm' })
  })
})
