export type AuthType = 'login' | 'api-key' | 'bedrock'
export type Platform = 'darwin' | 'win32' | 'linux'

export interface Profile {
  name: string
  type: AuthType
  env: Record<string, string>
  configDir?: string
  hasToken?: boolean
}

export interface ActiveState {
  name: string
  managedKeys: string[]
}

const AUTH_TYPES: AuthType[] = ['login', 'api-key', 'bedrock']
export function isAuthType(v: string): v is AuthType {
  return (AUTH_TYPES as string[]).includes(v)
}
