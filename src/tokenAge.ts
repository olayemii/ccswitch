import type { Profile } from './types.js'

// `claude setup-token` OAuth tokens are long-lived (~1 year). Warn once a
// captured token crosses this age so a stale token is surfaced before it fails
// mid-session in a parallel shell, rather than silently. Non-blocking.
export const TOKEN_STALE_DAYS = 300

const MS_PER_DAY = 24 * 60 * 60 * 1000

// Age of a captured token in whole days, or null if the profile has no captured
// token or no recorded capture timestamp (older profiles predate the field).
export function tokenAgeDays(profile: Profile, now: Date): number | null {
  if (!profile.hasToken || !profile.tokenCapturedAt) return null
  const captured = Date.parse(profile.tokenCapturedAt)
  if (Number.isNaN(captured)) return null
  return Math.floor((now.getTime() - captured) / MS_PER_DAY)
}

// A human-readable staleness warning, or null if the token is absent, has no
// timestamp, or is still fresh.
export function tokenStaleWarning(profile: Profile, now: Date): string | null {
  const age = tokenAgeDays(profile, now)
  if (age === null || age < TOKEN_STALE_DAYS) return null
  return `Profile '${profile.name}' has an OAuth token captured ${age} days ago; ` +
    `it may have expired. Re-capture with: ccswitch token ${profile.name}`
}
