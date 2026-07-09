import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run as realRun } from './exec.js'
import type { Profile } from './types.js'
import type { Paths } from './platform.js'

export function writeApiKeyHelper(profile: Profile, secret: string, paths: Paths): string {
  mkdirSync(paths.ccswitchDir, { recursive: true })
  const file = join(paths.ccswitchDir, `apikey-helper-${profile.name}.sh`)
  const escaped = secret.replace(/'/g, "'\\''")
  writeFileSync(file, `#!/bin/sh\nprintf '%s' '${escaped}'\n`, { encoding: 'utf8', mode: 0o700 })
  return file
}

export async function captureOAuthToken(deps: { run?: typeof realRun } = {}): Promise<string> {
  const run = deps.run ?? realRun
  const r = await run('claude', ['setup-token'])
  if (r.code !== 0) throw new Error(`claude setup-token failed: ${r.stderr.trim() || 'non-zero exit'}`)
  const token = r.stdout.trim()
  if (!token) throw new Error('claude setup-token returned no token')
  return token
}
