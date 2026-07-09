import type { Profile } from './types.js'

function sq(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}
function line(key: string, value: string): string {
  return `export ${key}=${sq(value)}`
}

const UNSET_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK',
  'AWS_PROFILE',
  'AWS_REGION',
  'CLAUDE_CONFIG_DIR',
]

export function buildEnvExport(profile: Profile, secret: string | null): string {
  const lines: string[] = []
  switch (profile.type) {
    case 'api-key':
      if (!secret) throw new Error(`No stored API key for profile '${profile.name}'.`)
      lines.push(line('ANTHROPIC_API_KEY', secret))
      break
    case 'bedrock':
      for (const key of ['CLAUDE_CODE_USE_BEDROCK', 'AWS_PROFILE', 'AWS_REGION']) {
        if (profile.env[key] !== undefined) lines.push(line(key, profile.env[key]))
      }
      break
    case 'login':
      if (!profile.hasToken || !secret) {
        throw new Error(
          `Profile '${profile.name}' has no captured OAuth token. Run: ccswitch token ${profile.name}`,
        )
      }
      lines.push(line('CLAUDE_CODE_OAUTH_TOKEN', secret))
      break
  }
  if (profile.configDir) lines.push(line('CLAUDE_CONFIG_DIR', profile.configDir))
  return lines.join('\n')
}

export function buildEnvUnset(): string {
  return UNSET_KEYS.map((k) => `unset ${k}`).join('\n')
}
