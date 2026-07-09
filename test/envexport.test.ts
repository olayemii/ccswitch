import { describe, it, expect } from 'vitest'
import { buildEnvExport, buildEnvUnset } from '../src/envexport.js'

describe('buildEnvExport', () => {
  it('api-key exports ANTHROPIC_API_KEY', () => {
    const out = buildEnvExport({ name: 'w', type: 'api-key', env: {} }, 'sk-123')
    expect(out).toBe("export ANTHROPIC_API_KEY='sk-123'")
  })

  it('bedrock exports the aws env fragment', () => {
    const out = buildEnvExport(
      { name: 'b', type: 'bedrock', env: { CLAUDE_CODE_USE_BEDROCK: '1', AWS_PROFILE: 'p', AWS_REGION: 'us-east-1' } },
      null,
    )
    expect(out).toContain("export CLAUDE_CODE_USE_BEDROCK='1'")
    expect(out).toContain("export AWS_PROFILE='p'")
    expect(out).toContain("export AWS_REGION='us-east-1'")
  })

  it('bedrock-key exports CLAUDE_CODE_USE_BEDROCK, AWS_REGION and AWS_BEARER_TOKEN_BEDROCK', () => {
    const out = buildEnvExport(
      { name: 'bk', type: 'bedrock-key', env: { CLAUDE_CODE_USE_BEDROCK: '1', AWS_REGION: 'us-west-2' } },
      'brk-secret',
    )
    expect(out).toContain("export CLAUDE_CODE_USE_BEDROCK='1'")
    expect(out).toContain("export AWS_REGION='us-west-2'")
    expect(out).toContain("export AWS_BEARER_TOKEN_BEDROCK='brk-secret'")
  })

  it('bedrock-key without a stored token throws', () => {
    expect(() => buildEnvExport({ name: 'bk', type: 'bedrock-key', env: { CLAUDE_CODE_USE_BEDROCK: '1' } }, null)).toThrow(/bedrock/i)
  })

  it('bedrock-key omits AWS_REGION when blank', () => {
    const out = buildEnvExport({ name: 'bk', type: 'bedrock-key', env: { CLAUDE_CODE_USE_BEDROCK: '1' } }, 'brk')
    expect(out).not.toContain('AWS_REGION')
    expect(out).toContain("export AWS_BEARER_TOKEN_BEDROCK='brk'")
  })

  it('login with token exports CLAUDE_CODE_OAUTH_TOKEN', () => {
    const out = buildEnvExport({ name: 'l', type: 'login', env: {}, hasToken: true }, 'oauth-xyz')
    expect(out).toBe("export CLAUDE_CODE_OAUTH_TOKEN='oauth-xyz'")
  })

  it('login without token throws pointing to ccswitch token', () => {
    expect(() => buildEnvExport({ name: 'l', type: 'login', env: {} }, null)).toThrow(/ccswitch token l/)
  })

  it('adds CLAUDE_CONFIG_DIR when configDir set', () => {
    const out = buildEnvExport({ name: 'w', type: 'api-key', env: {}, configDir: '/home/u/.ccswitch/homes/w' }, 'sk')
    expect(out).toContain("export CLAUDE_CONFIG_DIR='/home/u/.ccswitch/homes/w'")
  })

  it('escapes single quotes in values', () => {
    const out = buildEnvExport({ name: 'w', type: 'api-key', env: {} }, "a'b")
    expect(out).toBe("export ANTHROPIC_API_KEY='a'\\''b'")
  })
})

describe('buildEnvUnset', () => {
  it('unsets every managed key', () => {
    const out = buildEnvUnset()
    for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'AWS_PROFILE', 'AWS_REGION', 'AWS_BEARER_TOKEN_BEDROCK', 'CLAUDE_CONFIG_DIR']) {
      expect(out).toContain(`unset ${k}`)
    }
  })
})
