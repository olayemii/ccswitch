import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { probeAnthropicKey } from '../src/anthropicLiveness.js'

describe('probeAnthropicKey', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('returns valid on 200', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 200 })
    const r = await probeAnthropicKey('sk-ant-valid')
    expect(r).toEqual({ result: 'valid', status: 200 })
  })

  it('returns valid on 403 (key exists but lacks permission)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 403 })
    const r = await probeAnthropicKey('sk-ant-restricted')
    expect(r).toEqual({ result: 'valid', status: 403 })
  })

  it('returns invalid on 401', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 401 })
    const r = await probeAnthropicKey('sk-ant-revoked')
    expect(r).toEqual({ result: 'invalid', status: 401 })
  })

  it('returns unknown on network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ENOTFOUND'))
    const r = await probeAnthropicKey('sk-ant-whatever')
    expect(r).toEqual({ result: 'unknown', error: 'ENOTFOUND' })
  })

  it('returns unknown on unexpected status', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 500 })
    const r = await probeAnthropicKey('sk-ant-whatever')
    expect(r).toEqual({ result: 'unknown', status: 500 })
  })
})
