import { join } from 'node:path'
import { run as realRun } from './exec.js'
import { resolveLoginKeychain } from './secretStore.js'
import type { Profile, Platform } from './types.js'
import type { Paths } from './platform.js'

function singleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

function doubleQuoteWin(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export async function buildApiKeyHelperCommand(profile: Profile, plat: Platform, paths: Paths): Promise<string> {
  if (plat === 'darwin') {
    const keychain = await resolveLoginKeychain()
    const service = singleQuote(`ccswitch:${profile.name}`)
    return `security find-generic-password -s ${service} -a secret -w ${singleQuote(keychain)}`
  }
  if (plat === 'win32') {
    const file = join(paths.secretsDir, profile.name)
    return `type ${doubleQuoteWin(file)}`
  }
  const file = join(paths.secretsDir, profile.name)
  return `cat ${singleQuote(file)}`
}

export async function captureOAuthToken(deps: { run?: typeof realRun } = {}): Promise<string> {
  const run = deps.run ?? realRun
  const r = await run('claude', ['setup-token'])
  if (r.code !== 0) throw new Error(`claude setup-token failed: ${r.stderr.trim() || 'non-zero exit'}`)
  const token = r.stdout.trim()
  if (!token) throw new Error('claude setup-token returned no token')
  return token
}
