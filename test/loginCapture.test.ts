import { describe, it, expect, vi } from 'vitest'
import { captureLogin, type CaptureLoginDeps } from '../src/loginCapture.js'
import { hashCredential } from '../src/fingerprint.js'
import type { Profile } from '../src/types.js'

function baseDeps(over: Partial<CaptureLoginDeps> = {}): CaptureLoginDeps {
  return {
    profileName: 'new',
    profiles: [],
    runInteractive: vi.fn().mockResolvedValue({ code: 0 }),
    readAuthStatus: vi.fn().mockResolvedValue({ loggedIn: true }),
    readLiveCredential: vi.fn()
      .mockResolvedValueOnce('PREV')   // snapshot
      .mockResolvedValueOnce('NEWCRED'), // post-login capture
    writeLiveCredential: vi.fn().mockResolvedValue(undefined),
    neutralizeLiveCredential: vi.fn().mockResolvedValue(undefined),
    setSecret: vi.fn().mockResolvedValue(undefined),
    confirmDuplicate: vi.fn().mockResolvedValue(true),
    ...over,
  }
}

describe('captureLogin', () => {
  it('captures credential, stores it, and restores the previous live credential', async () => {
    const deps = baseDeps()
    const res = await captureLogin(deps)
    expect(res).toEqual({ credHash: hashCredential('NEWCRED') })
    expect(deps.setSecret).toHaveBeenCalledWith('NEWCRED')
    expect(deps.writeLiveCredential).toHaveBeenCalledWith('PREV')
    expect(deps.neutralizeLiveCredential).not.toHaveBeenCalled()
  })

  it('neutralizes the live slot when there was no previous credential', async () => {
    const deps = baseDeps({
      readLiveCredential: vi.fn()
        .mockResolvedValueOnce(null)     // no prior
        .mockResolvedValueOnce('NEWCRED'),
    })
    await captureLogin(deps)
    expect(deps.neutralizeLiveCredential).toHaveBeenCalledTimes(1)
    expect(deps.writeLiveCredential).not.toHaveBeenCalled()
  })

  it('throws and restores when claude auth login exits non-zero', async () => {
    const deps = baseDeps({ runInteractive: vi.fn().mockResolvedValue({ code: 7 }) })
    await expect(captureLogin(deps)).rejects.toThrow(/did not complete/)
    expect(deps.setSecret).not.toHaveBeenCalled()
    expect(deps.writeLiveCredential).toHaveBeenCalledWith('PREV')
  })

  it('throws and restores when status reports not logged in', async () => {
    const deps = baseDeps({ readAuthStatus: vi.fn().mockResolvedValue({ loggedIn: false }) })
    await expect(captureLogin(deps)).rejects.toThrow(/did not complete/)
    expect(deps.writeLiveCredential).toHaveBeenCalledWith('PREV')
  })

  it('aborts (returns null) without saving when a duplicate is declined', async () => {
    const existing: Profile = { name: 'work', type: 'login', env: {}, credHash: hashCredential('NEWCRED') }
    const deps = baseDeps({ profiles: [existing], confirmDuplicate: vi.fn().mockResolvedValue(false) })
    const res = await captureLogin(deps)
    expect(res).toBeNull()
    expect(deps.setSecret).not.toHaveBeenCalled()
    expect(deps.writeLiveCredential).toHaveBeenCalledWith('PREV')
  })
})
