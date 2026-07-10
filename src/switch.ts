import { patchSettings, type DesiredSettings } from './settings.js'
import type { Profile, Platform } from './types.js'
import type { Paths } from './platform.js'

export interface SwitchDeps {
  plat: Platform
  paths: Paths
  now: string
  loadSettings: (file: string) => any
  saveSettings: (file: string, settings: any, now: string) => void
  getSecret: (name: string, plat: Platform, paths: Paths) => Promise<string | null>
  writeLiveCredential: (value: string, plat: Platform, paths: Paths) => Promise<void>
  neutralizeLiveCredential: (plat: Platform, paths: Paths) => Promise<void>
  readActive: (paths: Paths) => { name: string; managedKeys: string[] } | null
  writeActive: (state: { name: string; managedKeys: string[] }, paths: Paths) => void
  writeApiKeyHelper: (profile: Profile) => string | Promise<string>
  loadProfile: (name: string, paths: Paths) => Profile
  readLiveCredential: (plat: Platform, paths: Paths) => Promise<string | null>
  setSecret: (name: string, value: string, plat: Platform, paths: Paths) => Promise<void>
  readOAuthAccount: (paths: Paths) => unknown
  writeOAuthAccount: (paths: Paths, account: unknown) => void
  saveProfile: (profile: Profile, paths: Paths) => void
}

export async function globalSwitch(profile: Profile, deps: SwitchDeps): Promise<{ warning?: string }> {
  const prev = deps.readActive(deps.paths)
  const prevManaged = prev?.managedKeys ?? []
  const warnings: string[] = []

  // Claude Code rotates the live OAuth credential as it runs, invalidating the
  // copy captured at `save` time. Before we switch away from a login profile,
  // re-snapshot the current live credential into its store so switching back
  // restores a valid credential instead of a stale one (which forces relogin).
  if (prev && prev.name !== profile.name) {
    // The outgoing profile may have been renamed or removed since it was made
    // active, leaving active.json pointing at a profile that no longer exists.
    // The re-snapshot is best-effort, so a missing profile is not fatal — skip it.
    let prevProfile: Profile | null = null
    try {
      prevProfile = deps.loadProfile(prev.name, deps.paths)
    } catch {
      prevProfile = null
    }
    if (prevProfile?.type === 'login') {
      const live = await deps.readLiveCredential(deps.plat, deps.paths)
      if (live !== null) await deps.setSecret(prev.name, live, deps.plat, deps.paths)
      const liveAccount = deps.readOAuthAccount(deps.paths)
      if (liveAccount != null) deps.saveProfile({ ...prevProfile, oauthAccount: liveAccount }, deps.paths)
    }

    // Warn when switching from a Bedrock profile (bedrock or bedrock-key) that sets
    // env vars to a non-Bedrock profile. The env vars in settings.json will be cleared,
    // but any shell environment variables will persist and take precedence.
    const prevWasBedrock = prevProfile && (prevProfile.type === 'bedrock' || prevProfile.type === 'bedrock-key')
    const currentIsNotBedrock = profile.type !== 'bedrock' && profile.type !== 'bedrock-key'
    if (prevWasBedrock && currentIsNotBedrock) {
      warnings.push('Switched from a Bedrock profile. If this shell has CLAUDE_CODE_USE_BEDROCK or AWS_BEARER_TOKEN_BEDROCK ' +
        'set in the environment, they will take precedence over the new profile. Open a new terminal to pick up the change.')
    }
  }

  // Config isolation is expressed only via the CLAUDE_CONFIG_DIR environment
  // variable, which a machine-wide switch cannot set for the desktop app or IDE.
  // So a global switch does NOT redirect Claude at the isolated dir — isolation
  // only takes effect per-shell (ccuse). Say so rather than silently ignoring it.
  if (profile.configDir) {
    warnings.push(`Profile '${profile.name}' has an isolated config dir, but isolation only applies per-shell. ` +
      `This global switch uses the shared config. For the isolated config, use: ccuse ${profile.name}`)
  }

  let desired: DesiredSettings
  let applyCredential: () => Promise<void>

  switch (profile.type) {
    case 'login': {
      const secret = await deps.getSecret(profile.name, deps.plat, deps.paths)
      if (secret === null) throw new Error(`No stored credential for profile '${profile.name}'. Run: ccswitch save ${profile.name}`)
      desired = { env: {}, apiKeyHelper: null }
      applyCredential = async () => {
        await deps.writeLiveCredential(secret, deps.plat, deps.paths)
        if (profile.oauthAccount != null) deps.writeOAuthAccount(deps.paths, profile.oauthAccount)
      }
      break
    }
    case 'api-key': {
      const secret = await deps.getSecret(profile.name, deps.plat, deps.paths)
      if (secret === null) throw new Error(`No stored API key for profile '${profile.name}'.`)
      const helperCommand = await deps.writeApiKeyHelper(profile)
      desired = { env: {}, apiKeyHelper: helperCommand }
      applyCredential = () => deps.neutralizeLiveCredential(deps.plat, deps.paths)
      break
    }
    case 'bedrock': {
      desired = { env: { ...profile.env }, apiKeyHelper: null }
      applyCredential = () => deps.neutralizeLiveCredential(deps.plat, deps.paths)
      break
    }
    case 'bedrock-key': {
      const secret = await deps.getSecret(profile.name, deps.plat, deps.paths)
      if (secret === null) throw new Error(`No stored Bedrock API key for profile '${profile.name}'.`)
      desired = { env: { ...profile.env, AWS_BEARER_TOKEN_BEDROCK: secret }, apiKeyHelper: null }
      applyCredential = () => deps.neutralizeLiveCredential(deps.plat, deps.paths)
      break
    }
  }

  // Apply the fragile credential step first. If this throws, nothing on disk
  // has changed yet, so the previous profile remains fully active.
  await applyCredential()

  try {
    const current = deps.loadSettings(deps.paths.settingsFile)
    const { settings, managedKeys } = patchSettings(current, desired, prevManaged)
    deps.saveSettings(deps.paths.settingsFile, settings, deps.now)
    deps.writeActive({ name: profile.name, managedKeys }, deps.paths)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Credential switched to '${profile.name}' but settings.json/active.json may now be inconsistent: ${reason}. ` +
      `A timestamped backup of the previous settings.json (settings.json.bak.${deps.now}) may exist — inspect it and restore manually if needed.`,
    )
  }

  return { warning: warnings.length > 0 ? warnings.join('\n\n') : undefined }
}
