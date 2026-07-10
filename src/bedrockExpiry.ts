import type { Profile } from './types.js'

// Tokens within this window of expiry are surfaced as "expiring" — a loud but
// non-blocking heads-up, mirroring TOKEN_STALE_DAYS in tokenAge.ts.
export const BEDROCK_EXPIRING_MS = 30 * 60 * 1000

const SHORT_TERM_PREFIX = 'bedrock-api-key-'

// Parse an AWS SigV4 amz date (YYYYMMDDTHHMMSSZ) into epoch ms, or null.
function parseAmzDate(v: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(v)
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m
  const ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)
  return Number.isNaN(ms) ? null : ms
}

// Derive an absolute ISO expiry from a short-term Bedrock API key. Short-term
// keys are `bedrock-api-key-<base64(presigned URL)>`; the URL query carries
// X-Amz-Date and X-Amz-Expires (seconds). Long-term `ABSK…` keys and anything
// unparseable return null (the caller treats that as "untracked").
export function deriveBedrockKeyExpiry(token: string): string | null {
  if (!token.startsWith(SHORT_TERM_PREFIX)) return null
  let decoded: string
  try {
    decoded = Buffer.from(token.slice(SHORT_TERM_PREFIX.length), 'base64').toString('utf8')
  } catch {
    return null
  }
  const q = decoded.indexOf('?')
  if (q === -1) return null
  const params = new URLSearchParams(decoded.slice(q + 1))
  const amzDate = params.get('X-Amz-Date')
  const expiresSec = params.get('X-Amz-Expires')
  if (!amzDate || !expiresSec) return null
  const start = parseAmzDate(amzDate)
  const secs = Number(expiresSec)
  if (start === null || !Number.isFinite(secs)) return null
  return new Date(start + secs * 1000).toISOString()
}

export type BedrockExpiryState = 'fresh' | 'expiring' | 'expired' | 'untracked'

// Signed status for a profile's stored expiry. expiresInMs is positive when
// time remains, negative once expired, null when untracked. Only bedrock-key
// profiles with a recorded credExpiresAt are ever tracked.
export function bedrockExpiryStatus(
  profile: Profile,
  now: Date,
): { state: BedrockExpiryState; expiresInMs: number | null } {
  if (profile.type !== 'bedrock-key' || !profile.credExpiresAt) {
    return { state: 'untracked', expiresInMs: null }
  }
  const exp = Date.parse(profile.credExpiresAt)
  if (Number.isNaN(exp)) return { state: 'untracked', expiresInMs: null }
  const remaining = exp - now.getTime()
  const state: BedrockExpiryState =
    remaining <= 0 ? 'expired' : remaining <= BEDROCK_EXPIRING_MS ? 'expiring' : 'fresh'
  return { state, expiresInMs: remaining }
}

// Whole-unit duration like "3h", "12m", or "0m" (minutes under an hour, hours otherwise).
function humanizeMs(ms: number): string {
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h`
}

// Short badge for doctor/list, or null when untracked.
export function describeBedrockExpiry(profile: Profile, now: Date): string | null {
  const { state, expiresInMs } = bedrockExpiryStatus(profile, now)
  if (state === 'untracked' || expiresInMs === null) return null
  if (state === 'expired') return `EXPIRED (${humanizeMs(-expiresInMs)} ago)`
  if (state === 'expiring') return `EXPIRING (${humanizeMs(expiresInMs)})`
  return `in ${humanizeMs(expiresInMs)}`
}

// Block/error message when a bedrock-key token is confidently expired, else null.
export function bedrockExpiredMessage(profile: Profile, now: Date): string | null {
  const { state, expiresInMs } = bedrockExpiryStatus(profile, now)
  if (state !== 'expired' || expiresInMs === null) return null
  return (
    `Profile '${profile.name}' Bedrock token expired ${humanizeMs(-expiresInMs)} ago. ` +
    `Refresh it: ccswitch refresh ${profile.name}`
  )
}

// Loud but non-blocking heads-up when a token is within the expiring window, else null.
export function bedrockExpiringWarning(profile: Profile, now: Date): string | null {
  const { state, expiresInMs } = bedrockExpiryStatus(profile, now)
  if (state !== 'expiring' || expiresInMs === null) return null
  return (
    `Profile '${profile.name}' Bedrock token expires in ${humanizeMs(expiresInMs)}. ` +
    `Refresh soon: ccswitch refresh ${profile.name}`
  )
}
