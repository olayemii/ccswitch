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
  writeApiKeyHelper: (profile: Profile, secret: string) => string
}

export async function globalSwitch(profile: Profile, deps: SwitchDeps): Promise<void> {
  const prev = deps.readActive(deps.paths)
  const prevManaged = prev?.managedKeys ?? []

  let desired: DesiredSettings
  let applyCredential: () => Promise<void>

  switch (profile.type) {
    case 'login': {
      const secret = await deps.getSecret(profile.name, deps.plat, deps.paths)
      if (secret === null) throw new Error(`No stored credential for profile '${profile.name}'. Run: ccswitch save ${profile.name}`)
      desired = { env: {}, apiKeyHelper: null }
      applyCredential = () => deps.writeLiveCredential(secret, deps.plat, deps.paths)
      break
    }
    case 'api-key': {
      const secret = await deps.getSecret(profile.name, deps.plat, deps.paths)
      if (secret === null) throw new Error(`No stored API key for profile '${profile.name}'.`)
      const helperPath = deps.writeApiKeyHelper(profile, secret)
      desired = { env: {}, apiKeyHelper: helperPath }
      applyCredential = () => deps.neutralizeLiveCredential(deps.plat, deps.paths)
      break
    }
    case 'bedrock': {
      desired = { env: { ...profile.env }, apiKeyHelper: null }
      applyCredential = () => deps.neutralizeLiveCredential(deps.plat, deps.paths)
      break
    }
  }

  const current = deps.loadSettings(deps.paths.settingsFile)
  const { settings, managedKeys } = patchSettings(current, desired, prevManaged)
  deps.saveSettings(deps.paths.settingsFile, settings, deps.now)
  await applyCredential()
  deps.writeActive({ name: profile.name, managedKeys }, deps.paths)
}
