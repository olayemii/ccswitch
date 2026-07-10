import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs'
import type { Paths } from './platform.js'

// ~/.claude.json is Claude Code's global state file (~90 keys). `oauthAccount`
// is the cached identity (email, org, uuid) that `claude auth status` and the
// app display — it is separate from the OAuth credential in the keychain, so
// switching the credential alone does not change the displayed account.

export function readOAuthAccount(paths: Paths): unknown | null {
  if (!existsSync(paths.claudeJsonFile)) return null
  try {
    const parsed = JSON.parse(readFileSync(paths.claudeJsonFile, 'utf8'))
    return parsed.oauthAccount ?? null
  } catch {
    return null
  }
}

export function writeOAuthAccount(paths: Paths, account: unknown): void {
  if (!existsSync(paths.claudeJsonFile)) return
  let parsed: any
  try {
    parsed = JSON.parse(readFileSync(paths.claudeJsonFile, 'utf8'))
  } catch {
    return
  }
  parsed.oauthAccount = account
  const tmpFile = `${paths.claudeJsonFile}.tmp.${process.pid}`
  writeFileSync(tmpFile, JSON.stringify(parsed, null, 2), 'utf8')
  renameSync(tmpFile, paths.claudeJsonFile)
}
