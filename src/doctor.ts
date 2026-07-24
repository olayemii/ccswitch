import type { Profile, ActiveState } from './types.js'
import { tokenStaleWarning, tokenAgeDays } from './tokenAge.js'
import { describeBedrockExpiry, bedrockExpiryStatus } from './bedrockExpiry.js'

export type FindingLevel = 'ok' | 'warn' | 'error'

// Mask a stored secret for display: never reveal the full value. Long secrets
// show first-6 + last-4; short ones show only last-4 to avoid over-exposure.
export function maskSecret(value: string | null | undefined): string {
  if (!value) return '(none)'
  const len = value.length
  if (len >= 12) return `${value.slice(0, 6)}…${value.slice(-4)} (len ${len})`
  const revealed = Math.min(4, len - 1)
  return `…${revealed > 0 ? value.slice(-revealed) : ''} (len ${len})`
}
export interface Finding {
  level: FindingLevel
  message: string
}

// Per-profile presence of secret-store slots and (for isolated profiles)
// whether the configDir still exists on disk.
export interface ProfileState {
  hasSecret: boolean
  hasToken: boolean
  configDirExists: boolean
  // Raw stored secret value for the active api-key/bedrock-key profile only,
  // captured by the CLI so describeActive() can render a masked preview.
  // Unset for all other profiles.
  secretPreview?: string
}

export interface DoctorSnapshot {
  profiles: Profile[]
  active: ActiveState | null
  settings: any
  // Whether Claude Code currently has a live login credential (keychain item
  // on macOS / .credentials.json elsewhere).
  liveCredentialPresent: boolean
  // Keyed by profile name.
  profileStates: Record<string, ProfileState>
  now: Date
}

// Cross-check the ccswitch bookkeeping against the live Claude Code state and
// report drift. Pure: all I/O is captured in the snapshot so this is unit-testable.
export function diagnose(snap: DoctorSnapshot): Finding[] {
  const findings: Finding[] = []
  const byName = new Map(snap.profiles.map((p) => [p.name, p]))

  // --- Active pointer ---
  if (snap.active === null) {
    findings.push({ level: 'ok', message: 'No active profile pointer (nothing has been switched to yet).' })
  } else if (!byName.has(snap.active.name)) {
    findings.push({
      level: 'error',
      message: `Active pointer references '${snap.active.name}', which no longer exists. ` +
        `Switch to a real profile to fix: ccswitch <name>`,
    })
  } else {
    findings.push({ level: 'ok', message: `Active profile: ${snap.active.name}` })
    checkActiveConsistency(byName.get(snap.active.name)!, snap, findings)
  }

  // --- Per-profile secret / config integrity ---
  for (const profile of snap.profiles) {
    const st = snap.profileStates[profile.name] ?? { hasSecret: false, hasToken: false, configDirExists: false }

    if (profile.type === 'login') {
      if (!st.hasSecret) {
        findings.push({
          level: 'warn',
          message: `Login profile '${profile.name}' has no stored credential. Re-snapshot with: ccswitch save ${profile.name} --type login`,
        })
      }
      if (profile.hasToken && !st.hasToken) {
        findings.push({
          level: 'error',
          message: `Login profile '${profile.name}' is marked as having an OAuth token, but no token is stored. Re-capture: ccswitch token ${profile.name}`,
        })
      }
      const stale = tokenStaleWarning(profile, snap.now)
      if (stale) findings.push({ level: 'warn', message: stale })
    } else if (profile.type === 'api-key' || profile.type === 'bedrock-key' || profile.type === 'custom') {
      if (!st.hasSecret) {
        findings.push({
          level: 'error',
          message: `Profile '${profile.name}' (${profile.type}) has no stored secret. Re-create it: ccswitch add`,
        })
      }
      if (profile.type === 'bedrock-key') {
        const bexp = bedrockExpiryStatus(profile, snap.now)
        if (bexp.state === 'expired') {
          findings.push({
            level: 'warn',
            message: `Bedrock profile '${profile.name}' token has expired. Refresh: ccswitch refresh ${profile.name}`,
          })
        } else if (bexp.state === 'expiring') {
          findings.push({
            level: 'warn',
            message: `Bedrock profile '${profile.name}' token expires soon. Refresh: ccswitch refresh ${profile.name}`,
          })
        }
      }
    }

    if (profile.configDir && !st.configDirExists) {
      findings.push({
        level: 'warn',
        message: `Profile '${profile.name}' points at isolated config dir '${profile.configDir}', which is missing.`,
      })
    }
  }

  return findings
}

// Read email/org defensively from the cached oauthAccount (typed unknown).
// Returns a display string like "email — org", "email", or null when absent.
function formatAccount(account: unknown): string | null {
  if (account == null || typeof account !== 'object') return null
  const email = (account as Record<string, unknown>).emailAddress
  if (typeof email !== 'string' || email === '') return null
  const org = (account as Record<string, unknown>).organizationName
  return typeof org === 'string' && org !== '' ? `${email} — ${org}` : email
}

// Human-readable details for the active profile only. Pure: reads everything
// from the snapshot. Returns display lines (no icons). diagnose() reports drift;
// this shows identity — who/what you are actually running as.
export function describeActive(snap: DoctorSnapshot): string[] {
  const active = snap.active
  if (active === null) return ['No active profile.']
  const profile = snap.profiles.find((p) => p.name === active.name)
  if (!profile) return ['No active profile.']

  const st = snap.profileStates[profile.name]
  const lines: string[] = ['Active profile details:']
  lines.push(`  name:        ${profile.name}`)
  lines.push(`  type:        ${profile.type}`)
  lines.push(`  config dir:  ${profile.configDir ?? '(default)'}`)

  if (profile.type === 'api-key' || profile.type === 'bedrock-key' || profile.type === 'custom') {
    lines.push(`  credential:  ${st?.secretPreview ? maskSecret(st.secretPreview) : '(missing)'}`)
  }

  if (profile.type === 'custom') {
    lines.push(`  base url:    ${profile.env.ANTHROPIC_BASE_URL ?? '(missing)'}`)
  }

  if (profile.type === 'bedrock-key') {
    const badge = describeBedrockExpiry(profile, snap.now)
    if (badge) lines.push(`  expires:     ${badge}`)
  }

  if (profile.type === 'login') {
    const account = formatAccount(profile.oauthAccount)
    if (account) lines.push(`  account:     ${account}`)

    if (!profile.hasToken) {
      lines.push('  token:       none captured')
    } else if (!profile.tokenCapturedAt) {
      lines.push('  token:       present, capture date unknown')
    } else {
      const age = tokenAgeDays(profile, snap.now)
      if (age === null) {
        lines.push('  token:       present, capture date unknown')
      } else {
        const date = profile.tokenCapturedAt.slice(0, 10)
        lines.push(`  token:       captured ${age} days ago (${date})`)
      }
    }
  }

  return lines
}

function checkActiveConsistency(active: Profile, snap: DoctorSnapshot, findings: Finding[]): void {
  const env = snap.settings?.env ?? {}
  const hasHelper = typeof snap.settings?.apiKeyHelper === 'string'

  // Custom-endpoint keys left in settings.json while a non-custom profile is
  // active. `switch` only clears keys it previously managed, so a base URL/token
  // that arrived any other way (a hand-edit, or `save --type custom` before this
  // profile was ever switched to) survives and silently outranks the active auth.
  if (active.type !== 'custom') {
    if (env.ANTHROPIC_AUTH_TOKEN) {
      findings.push({
        level: 'error',
        message: `settings.json still has ANTHROPIC_AUTH_TOKEN from a custom endpoint, but the active profile '${active.name}' is ${active.type}. ` +
          `It overrides '${active.name}' credentials. Remove it from settings.json, then re-switch: ccswitch ${active.name}`,
      })
    }
    if (env.ANTHROPIC_BASE_URL) {
      findings.push({
        level: 'warn',
        message: `settings.json has ANTHROPIC_BASE_URL ('${env.ANTHROPIC_BASE_URL}') while the active profile '${active.name}' is ${active.type} — ` +
          `its credentials will be sent to that endpoint. Intentional (a proxy) is fine; otherwise remove it and re-switch: ccswitch ${active.name}`,
      })
    }
  }

  switch (active.type) {
    case 'login':
      if (hasHelper) {
        findings.push({ level: 'warn', message: `Active profile is a login, but settings.json still has an apiKeyHelper — it will override the login. Re-switch: ccswitch ${active.name}` })
      }
      if (!snap.liveCredentialPresent) {
        findings.push({ level: 'warn', message: `Active login profile '${active.name}' has no live credential — Claude Code will prompt for login. Re-switch or re-login.` })
      }
      break
    case 'api-key':
      if (!hasHelper) {
        findings.push({ level: 'error', message: `Active profile '${active.name}' is an api-key, but settings.json has no apiKeyHelper. Re-switch: ccswitch ${active.name}` })
      }
      break
    case 'bedrock':
      if (env.CLAUDE_CODE_USE_BEDROCK !== '1') {
        findings.push({ level: 'error', message: `Active profile '${active.name}' is bedrock, but CLAUDE_CODE_USE_BEDROCK is not set in settings.json. Re-switch: ccswitch ${active.name}` })
      }
      break
    case 'bedrock-key':
      if (!env.AWS_BEARER_TOKEN_BEDROCK) {
        findings.push({ level: 'error', message: `Active profile '${active.name}' is bedrock-key, but AWS_BEARER_TOKEN_BEDROCK is not set in settings.json. Re-switch: ccswitch ${active.name} (or, if the token has expired, ccswitch refresh ${active.name}).` })
      }
      break
    case 'custom':
      if (hasHelper) {
        findings.push({ level: 'warn', message: `Active profile is custom, but settings.json still has an apiKeyHelper — it may override the endpoint auth. Re-switch: ccswitch ${active.name}` })
      }
      if (!env.ANTHROPIC_BASE_URL || !env.ANTHROPIC_AUTH_TOKEN) {
        findings.push({ level: 'error', message: `Active profile '${active.name}' is custom, but ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN are not both set in settings.json. Re-switch: ccswitch ${active.name}` })
      }
      break
  }
}
