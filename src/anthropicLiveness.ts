// Lightweight liveness probe for Anthropic API keys.
// Hits /v1/models — a cheap, read-only endpoint that returns 401 on invalid keys.

export type AnthropicLivenessResult = 'valid' | 'invalid' | 'unknown'

export async function probeAnthropicKey(
  apiKey: string,
  timeoutMs = 8000,
): Promise<{ result: AnthropicLivenessResult; status?: number; error?: string }> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch('https://api.anthropic.com/v1/models', {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (res.status === 200) return { result: 'valid', status: 200 }
    if (res.status === 401) return { result: 'invalid', status: 401 }
    // 403 means the key exists but lacks model-list permission — still "valid" as a credential
    if (res.status === 403) return { result: 'valid', status: 403 }
    return { result: 'unknown', status: res.status }
  } catch (err: any) {
    return { result: 'unknown', error: err?.message ?? String(err) }
  }
}
