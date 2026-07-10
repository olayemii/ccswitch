import os from 'node:os'
import path from 'node:path'
import type { Platform } from './types.js'

export interface Paths {
  ccswitchDir: string
  profilesDir: string
  secretsDir: string
  homesDir: string
  activeFile: string
  claudeConfigDir: string
  settingsFile: string
  credentialsFile: string
  claudeJsonFile: string
}

export function getPlatform(): Platform {
  const p = process.platform
  if (p === 'darwin' || p === 'win32' || p === 'linux') return p
  return 'linux'
}

export function usesKeychain(plat: Platform): boolean {
  return plat === 'darwin'
}

function homeDir(env: NodeJS.ProcessEnv, plat: Platform): string {
  const h = plat === 'win32' ? env.USERPROFILE : env.HOME
  return h ?? os.homedir()
}

export function paths(env: NodeJS.ProcessEnv = process.env, plat: Platform = getPlatform()): Paths {
  const home = homeDir(env, plat)
  const ccswitchDir = path.join(home, '.ccswitch')
  const claudeConfigDir = env.CLAUDE_CONFIG_DIR ?? path.join(home, '.claude')
  // .claude.json is Claude Code's global state file — a sibling of ~/.claude,
  // not inside it. It moves alongside CLAUDE_CONFIG_DIR when set.
  const claudeJsonDir = env.CLAUDE_CONFIG_DIR ?? home
  return {
    ccswitchDir,
    profilesDir: path.join(ccswitchDir, 'profiles'),
    secretsDir: path.join(ccswitchDir, 'secrets'),
    homesDir: path.join(ccswitchDir, 'homes'),
    activeFile: path.join(ccswitchDir, 'active.json'),
    claudeConfigDir,
    settingsFile: path.join(claudeConfigDir, 'settings.json'),
    credentialsFile: path.join(claudeConfigDir, '.credentials.json'),
    claudeJsonFile: path.join(claudeJsonDir, '.claude.json'),
  }
}
