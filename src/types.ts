export type AuthType = 'login' | 'api-key' | 'bedrock' | 'bedrock-key'
export type Platform = 'darwin' | 'win32' | 'linux'

export interface Profile {
  name: string
  type: AuthType
  env: Record<string, string>
  configDir?: string
  hasToken?: boolean
  tokenCapturedAt?: string
  credHash?: string
  oauthAccount?: unknown
}

export interface ActiveState {
  name: string
  managedKeys: string[]
}

const AUTH_TYPES: AuthType[] = ['login', 'api-key', 'bedrock', 'bedrock-key']
export function isAuthType(v: string): v is AuthType {
  return (AUTH_TYPES as string[]).includes(v)
}
