import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Profile, ActiveState } from './types.js'
import type { Paths } from './platform.js'

function profileFile(name: string, paths: Paths): string {
  return join(paths.profilesDir, `${name}.json`)
}

export function saveProfile(profile: Profile, paths: Paths): void {
  mkdirSync(paths.profilesDir, { recursive: true })
  writeFileSync(profileFile(profile.name, paths), JSON.stringify(profile, null, 2) + '\n', 'utf8')
}

export function profileExists(name: string, paths: Paths): boolean {
  return existsSync(profileFile(name, paths))
}

export function loadProfile(name: string, paths: Paths): Profile {
  const file = profileFile(name, paths)
  if (!existsSync(file)) throw new Error(`Unknown profile: ${name}`)
  return JSON.parse(readFileSync(file, 'utf8')) as Profile
}

export function listProfiles(paths: Paths): Profile[] {
  if (!existsSync(paths.profilesDir)) return []
  return readdirSync(paths.profilesDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(paths.profilesDir, f), 'utf8')) as Profile)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function removeProfile(name: string, paths: Paths): void {
  const file = profileFile(name, paths)
  if (existsSync(file)) rmSync(file)
}

export function readActive(paths: Paths): ActiveState | null {
  if (!existsSync(paths.activeFile)) return null
  return JSON.parse(readFileSync(paths.activeFile, 'utf8')) as ActiveState
}

export function writeActive(state: ActiveState, paths: Paths): void {
  mkdirSync(paths.ccswitchDir, { recursive: true })
  writeFileSync(paths.activeFile, JSON.stringify(state, null, 2) + '\n', 'utf8')
}
