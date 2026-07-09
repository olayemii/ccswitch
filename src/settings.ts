import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'

export const MANAGED_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK',
  'AWS_PROFILE',
  'AWS_REGION',
] as const

export interface DesiredSettings {
  env?: Record<string, string>
  apiKeyHelper?: string | null
}

export function patchSettings(
  current: any,
  desired: DesiredSettings,
  prevManaged: string[],
): { settings: any; managedKeys: string[] } {
  const settings = structuredClone(current ?? {})
  const managedKeys: string[] = []
  const desiredEnv = desired.env ?? {}

  settings.env = { ...(settings.env ?? {}) }

  // First remove previously-managed env keys so stale ones don't linger.
  for (const key of prevManaged) {
    if (key.startsWith('env.')) {
      const envKey = key.slice('env.'.length)
      if (MANAGED_ENV_KEYS.includes(envKey as any)) delete settings.env[envKey]
    }
  }

  // Apply desired managed env keys.
  for (const envKey of MANAGED_ENV_KEYS) {
    if (envKey in desiredEnv) {
      settings.env[envKey] = desiredEnv[envKey]
      managedKeys.push(`env.${envKey}`)
    }
  }

  if (Object.keys(settings.env).length === 0) delete settings.env

  // apiKeyHelper: string sets, null clears, undefined leaves as-is unless it was previously managed.
  if (desired.apiKeyHelper === null) {
    delete settings.apiKeyHelper
  } else if (typeof desired.apiKeyHelper === 'string') {
    settings.apiKeyHelper = desired.apiKeyHelper
    managedKeys.push('apiKeyHelper')
  } else if (prevManaged.includes('apiKeyHelper')) {
    delete settings.apiKeyHelper
  }

  return { settings, managedKeys }
}

export function loadSettings(file: string): any {
  if (!existsSync(file)) return {}
  return JSON.parse(readFileSync(file, 'utf8'))
}

export function saveSettings(file: string, settings: any, now: string): void {
  if (existsSync(file)) {
    copyFileSync(file, `${file}.bak.${now}`)
  }
  writeFileSync(file, JSON.stringify(settings, null, 2) + '\n', 'utf8')
}
