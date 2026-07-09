import { describe, it, expect } from 'vitest'
import { isAuthType } from '../src/types.js'

describe('isAuthType', () => {
  it('accepts known types', () => {
    expect(isAuthType('login')).toBe(true)
    expect(isAuthType('api-key')).toBe(true)
    expect(isAuthType('bedrock')).toBe(true)
  })
  it('rejects unknown', () => {
    expect(isAuthType('vertex')).toBe(false)
  })
})
