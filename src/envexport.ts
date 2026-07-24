import type { Profile } from './types.js'
import { CUSTOM_MODEL_KEYS } from './settings.js'

function sq(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}
function line(key: string, value: string): string {
  return `export ${key}=${sq(value)}`
}

const UNSET_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK',
  'AWS_PROFILE',
  'AWS_REGION',
  'AWS_BEARER_TOKEN_BEDROCK',
  ...CUSTOM_MODEL_KEYS,
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
    case 'bedrock-key':
      if (!secret) throw new Error(`No stored Bedrock API key for profile '${profile.name}'.`)
      lines.push(line('CLAUDE_CODE_USE_BEDROCK', profile.env.CLAUDE_CODE_USE_BEDROCK ?? '1'))
      if (profile.env.AWS_REGION) lines.push(line('AWS_REGION', profile.env.AWS_REGION))
      lines.push(line('AWS_BEARER_TOKEN_BEDROCK', secret))
      break
    case 'login':
      if (!profile.hasToken || !secret) {
        throw new Error(
          `Profile '${profile.name}' has no captured OAuth token. Run: ccswitch token ${profile.name}`,
        )
      }
      lines.push(line('CLAUDE_CODE_OAUTH_TOKEN', secret))
      break
    case 'custom':
      if (!secret) throw new Error(`No stored token for profile '${profile.name}'.`)
      if (profile.env.ANTHROPIC_BASE_URL) lines.push(line('ANTHROPIC_BASE_URL', profile.env.ANTHROPIC_BASE_URL))
      lines.push(line('ANTHROPIC_AUTH_TOKEN', secret))
      for (const key of CUSTOM_MODEL_KEYS) {
        if (profile.env[key] !== undefined) lines.push(line(key, profile.env[key]))
      }
      break
  }
  if (profile.configDir) lines.push(line('CLAUDE_CONFIG_DIR', profile.configDir))
  return lines.join('\n')
}

export function buildEnvUnset(): string {
  return UNSET_KEYS.map((k) => `unset ${k}`).join('\n')
}
