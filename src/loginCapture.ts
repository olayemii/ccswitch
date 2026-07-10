import { hashCredential, findDuplicateLoginName } from './fingerprint.js'
import type { Profile } from './types.js'

export interface CaptureLoginDeps {
  profileName: string
  profiles: Profile[]
  runInteractive: (cmd: string, args: string[]) => Promise<{ code: number }>
  readAuthStatus: () => Promise<{ loggedIn: boolean; email?: string }>
  readLiveCredential: () => Promise<string | null>
  writeLiveCredential: (value: string) => Promise<void>
  neutralizeLiveCredential: () => Promise<void>
  setSecret: (value: string) => Promise<void>
  confirmDuplicate: (dupName: string) => Promise<boolean>
  afterCapture?: () => Promise<void>
}

export async function captureLogin(
  deps: CaptureLoginDeps,
): Promise<{ credHash: string } | null> {
  const prev = await deps.readLiveCredential()
  try {
    const { code } = await deps.runInteractive('claude', ['auth', 'login'])
    if (code !== 0) throw new Error('claude auth login did not complete — no profile added')
    const status = await deps.readAuthStatus()
    if (!status.loggedIn) throw new Error('login did not complete — no profile added')
    const cred = await deps.readLiveCredential()
    if (cred == null) throw new Error('could not read the new login credential — no profile added')
    const credHash = hashCredential(cred)
    const dup = findDuplicateLoginName(credHash, deps.profiles, deps.profileName)
    if (dup) {
      const proceed = await deps.confirmDuplicate(dup)
      if (!proceed) return null
    }
    await deps.setSecret(cred)
    if (deps.afterCapture) await deps.afterCapture()
    return { credHash }
  } finally {
    if (prev != null) await deps.writeLiveCredential(prev)
    else await deps.neutralizeLiveCredential()
  }
}
