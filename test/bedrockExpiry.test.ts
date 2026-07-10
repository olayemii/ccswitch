import { describe, it, expect } from 'vitest'
import {
  deriveBedrockKeyExpiry,
  bedrockExpiryStatus,
  describeBedrockExpiry,
  bedrockExpiredMessage,
  bedrockExpiringWarning,
  bedrockLivenessWarning,
  BEDROCK_EXPIRING_MS,
} from '../src/bedrockExpiry.js'
import type { Profile } from '../src/types.js'

// A short-term Bedrock API key is `bedrock-api-key-<base64(presigned URL)>`.
// The presigned URL query carries X-Amz-Date (YYYYMMDDTHHMMSSZ) and
// X-Amz-Expires (seconds). Build one so expiry = date + expires seconds.
function shortTermKey(amzDate: string, expiresSec: number): string {
  const url =
    'https://bedrock-runtime.us-east-1.amazonaws.com/?' +
    'X-Amz-Algorithm=AWS4-HMAC-SHA256' +
    `&X-Amz-Date=${amzDate}` +
    `&X-Amz-Expires=${expiresSec}` +
    '&X-Amz-SignedHeaders=host&X-Amz-Signature=deadbeef'
  return 'bedrock-api-key-' + Buffer.from(url, 'utf8').toString('base64')
}

describe('deriveBedrockKeyExpiry', () => {
  it('computes absolute expiry from X-Amz-Date + X-Amz-Expires', () => {
    // 2026-07-11T00:00:00Z + 12h = 2026-07-11T12:00:00Z
    const key = shortTermKey('20260711T000000Z', 43200)
    expect(deriveBedrockKeyExpiry(key)).toBe('2026-07-11T12:00:00.000Z')
  })

  it('returns null for a long-term ABSK key (no embedded expiry)', () => {
    expect(deriveBedrockKeyExpiry('ABSK' + Buffer.from('iam-user-info').toString('base64'))).toBeNull()
  })

  it('returns null for garbage', () => {
    expect(deriveBedrockKeyExpiry('not-a-real-token')).toBeNull()
  })

  it('returns null when the decoded URL lacks the signing params', () => {
    const key = 'bedrock-api-key-' + Buffer.from('https://x/?foo=bar', 'utf8').toString('base64')
    expect(deriveBedrockKeyExpiry(key)).toBeNull()
  })
})

const NOW = new Date('2026-07-11T00:00:00Z')
function keyProfile(overrides: Partial<Profile> = {}): Profile {
  return { name: 'work', type: 'bedrock-key', env: {}, ...overrides }
}
function atOffsetMs(ms: number): string {
  return new Date(NOW.getTime() + ms).toISOString()
}

describe('bedrockExpiryStatus', () => {
  it('is untracked without credExpiresAt', () => {
    expect(bedrockExpiryStatus(keyProfile(), NOW).state).toBe('untracked')
  })

  it('is untracked for non-bedrock-key profiles even with credExpiresAt', () => {
    const p: Profile = { name: 'k', type: 'api-key', env: {}, credExpiresAt: atOffsetMs(60_000) }
    expect(bedrockExpiryStatus(p, NOW).state).toBe('untracked')
  })

  it('is fresh well before expiry', () => {
    expect(bedrockExpiryStatus(keyProfile({ credExpiresAt: atOffsetMs(3 * 3600_000) }), NOW).state).toBe('fresh')
  })

  it('is expiring within the window', () => {
    expect(bedrockExpiryStatus(keyProfile({ credExpiresAt: atOffsetMs(BEDROCK_EXPIRING_MS - 60_000) }), NOW).state).toBe('expiring')
  })

  it('is expired at/after the expiry instant', () => {
    expect(bedrockExpiryStatus(keyProfile({ credExpiresAt: atOffsetMs(-60_000) }), NOW).state).toBe('expired')
  })
})

describe('describeBedrockExpiry', () => {
  it('is null when untracked', () => {
    expect(describeBedrockExpiry(keyProfile(), NOW)).toBeNull()
  })
  it('renders remaining time when fresh', () => {
    expect(describeBedrockExpiry(keyProfile({ credExpiresAt: atOffsetMs(3 * 3600_000) }), NOW)).toBe('in 3h')
  })
  it('renders EXPIRED with elapsed time', () => {
    expect(describeBedrockExpiry(keyProfile({ credExpiresAt: atOffsetMs(-2 * 3600_000) }), NOW)).toBe('EXPIRED (2h ago)')
  })
})

describe('bedrockExpiredMessage', () => {
  it('is null when not expired', () => {
    expect(bedrockExpiredMessage(keyProfile({ credExpiresAt: atOffsetMs(3600_000) }), NOW)).toBeNull()
  })
  it('names the profile and refresh command when expired', () => {
    const m = bedrockExpiredMessage(keyProfile({ credExpiresAt: atOffsetMs(-3600_000) }), NOW)
    expect(m).toContain("Profile 'work' Bedrock token expired")
    expect(m).toContain('ccswitch refresh work')
  })
})

describe('bedrockExpiringWarning', () => {
  it('is null when fresh', () => {
    expect(bedrockExpiringWarning(keyProfile({ credExpiresAt: atOffsetMs(3 * 3600_000) }), NOW)).toBeNull()
  })
  it('is null when already expired (that path blocks instead)', () => {
    expect(bedrockExpiringWarning(keyProfile({ credExpiresAt: atOffsetMs(-60_000) }), NOW)).toBeNull()
  })
  it('warns within the expiring window', () => {
    const w = bedrockExpiringWarning(keyProfile({ credExpiresAt: atOffsetMs(BEDROCK_EXPIRING_MS - 60_000) }), NOW)
    expect(w).toContain("Profile 'work' Bedrock token expires in")
    expect(w).toContain('ccswitch refresh work')
  })
})

describe('bedrockLivenessWarning', () => {
  it('is null on success', () => {
    expect(bedrockLivenessWarning('dev', 0)).toBeNull()
  })
  it('warns on failure, naming the profile', () => {
    const w = bedrockLivenessWarning('dev', 255)
    expect(w).toContain("AWS_PROFILE='dev'")
    expect(w).toContain('liveness check')
  })
})
