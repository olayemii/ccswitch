import { createHash } from 'node:crypto'
import type { Profile } from './types.js'

export function hashCredential(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function findDuplicateLoginName(
  credHash: string,
  profiles: Profile[],
  excludeName: string,
): string | null {
  for (const prof of profiles) {
    if (prof.type !== 'login') continue
    if (prof.name === excludeName) continue
    if (prof.credHash && prof.credHash === credHash) return prof.name
  }
  return null
}
