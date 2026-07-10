import { Command } from 'commander'
import path from 'node:path'
import { getPlatform, paths } from './platform.js'
import { listProfiles, loadProfile, readActive, removeProfile, profileExists, writeActive, assertValidProfileName } from './profiles.js'
import { getSecret, deleteSecret } from './secretStore.js'
import { buildEnvExport, buildEnvUnset } from './envexport.js'
import { loadSettings, saveSettings } from './settings.js'
import { writeLiveCredential, neutralizeLiveCredential, readLiveCredential, readAuthStatus } from './credentials.js'
import { buildApiKeyHelperCommand, captureOAuthToken } from './helpers.js'
import { globalSwitch } from './switch.js'
import { rmSync, existsSync, mkdirSync, cpSync, renameSync } from 'node:fs'
import * as clack from '@clack/prompts'
import { setSecret } from './secretStore.js'
import { saveProfile } from './profiles.js'
import { isAuthType, type Profile, type Platform } from './types.js'
import { hashCredential, findDuplicateLoginName } from './fingerprint.js'
import { runInteractive } from './exec.js'
import { captureLogin } from './loginCapture.js'
import { readOAuthAccount, writeOAuthAccount } from './oauthAccount.js'
import { tokenStaleWarning } from './tokenAge.js'
import { diagnose, describeActive, type DoctorSnapshot, type ProfileState } from './doctor.js'
import { deriveBedrockKeyExpiry, describeBedrockExpiry, bedrockExpiredMessage, bedrockExpiringWarning } from './bedrockExpiry.js'

function nowIso(): string {
  // Injected-free deterministic-ish timestamp; Date is allowed at runtime (not in workflow scripts).
  return new Date().toISOString().replace(/[:.]/g, '-')
}

export async function runCli(
  argv: string[],
  opts: { platform?: Platform; env?: NodeJS.ProcessEnv } = {},
): Promise<number> {
  const program = new Command()
  program.name('ccswitch').version('0.1.0').exitOverride()
  const plat = opts.platform ?? getPlatform()
  const env = opts.env ?? process.env
  const p = paths(env, plat)

  program
    .command('list')
    .description('show profiles and mark the active one')
    .action(() => {
      const active = readActive(p)?.name
      const profiles = listProfiles(p)
      if (profiles.length === 0) { process.stdout.write('No profiles. Add one with: ccswitch add\n'); return }
      const now = new Date()
      for (const prof of profiles) {
        const mark = prof.name === active ? '* ' : '  '
        const stale = tokenStaleWarning(prof, now) ? '  [stale token]' : ''
        process.stdout.write(`${mark}${prof.name} (${prof.type})${stale}\n`)
      }
      for (const prof of profiles) {
        const w = tokenStaleWarning(prof, now)
        if (w) process.stderr.write(`Warning: ${w}\n`)
      }
    })

  program
    .command('current')
    .description('print active profile')
    .action(() => {
      const active = readActive(p)
      process.stdout.write((active?.name ?? '(none)') + '\n')
    })

  program
    .command('help')
    .description('overview of auth types and common commands')
    .action(() => {
      process.stdout.write(
        [
          'ccswitch — switch Claude Code auth profiles globally or per-shell.',
          '',
          'Auth types:',
          '  login        Subscription OAuth. Global: restores the login credential.',
          '               Per-shell: needs a captured token (ccswitch token <name>).',
          '  api-key      Anthropic API key. Global: apiKeyHelper reads it from the',
          '               keychain at runtime. Per-shell: exports ANTHROPIC_API_KEY.',
          '  bedrock      Bedrock via AWS credentials (SigV4). Sets CLAUDE_CODE_USE_BEDROCK,',
          '               AWS_PROFILE, AWS_REGION. No secret stored.',
          '  bedrock-key  Bedrock via API key (bearer token). Sets CLAUDE_CODE_USE_BEDROCK',
          '               and AWS_BEARER_TOKEN_BEDROCK. Global switch writes the token into',
          '               settings.json in PLAINTEXT (cleared when you switch away).',
          '',
          'Common commands:',
          '  ccswitch add               guided setup (login / api-key / bedrock / bedrock-key)',
          '  ccswitch save <name> --type <t>   snapshot current live state into a profile',
          '  ccswitch token <name>      capture a per-shell OAuth token (login profiles)',
          '  ccswitch <name>            switch globally (restart desktop app / IDE)',
          '  ccswitch env <name>        print exports for the current shell (see: ccuse)',
          '  ccswitch list | current    show profiles / the active one',
          '  ccswitch remove <name>     delete a profile, its secret and isolated dir',
          '  ccswitch shellinit         print the ccuse shell helper',
        ].join('\n') + '\n',
      )
    })

  program
    .command('env [name]')
    .option('--unset', 'print unset statements')
    .description('print export statements for the current shell')
    .action(async (name: string | undefined, opts: { unset?: boolean }) => {
      if (opts.unset) { process.stdout.write(buildEnvUnset() + '\n'); return }
      if (!name) throw new Error('Usage: ccswitch env <name> | ccswitch env --unset')
      if (!profileExists(name, p)) throw new Error(`Unknown profile: ${name}. See: ccswitch list`)
      const profile = loadProfile(name, p)
      const secret = await getSecret(name, plat, p, { slot: profile.type === 'login' ? 'token' : 'secret' })
      const stale = tokenStaleWarning(profile, new Date())
      if (stale) process.stderr.write(`Warning: ${stale}\n`)
      process.stdout.write(buildEnvExport(profile, secret) + '\n')
    })

  program
    .command('rename <from> <to>')
    .description('rename a profile, its secrets, isolated dir, and active pointer')
    .action(async (from: string, to: string) => {
      if (!profileExists(from, p)) throw new Error(`Unknown profile: ${from}. See: ccswitch list`)
      assertValidProfileName(to)
      if (profileExists(to, p)) throw new Error(`Profile '${to}' already exists.`)
      const profile = loadProfile(from, p)

      // Re-key secrets: copy each present slot to the new name, then delete the old.
      for (const slot of ['secret', 'token'] as const) {
        const value = await getSecret(from, plat, p, { slot })
        if (value !== null) {
          await setSecret(to, value, plat, p, { slot })
          await deleteSecret(from, plat, p, { slot })
        }
      }

      // Move the isolated config dir alongside the new name so it stays discoverable.
      let configDir = profile.configDir
      if (configDir && existsSync(configDir)) {
        const dest = path.join(p.homesDir, to)
        renameSync(configDir, dest)
        configDir = dest
      }

      saveProfile({ ...profile, name: to, configDir }, p)
      removeProfile(from, p)

      const active = readActive(p)
      if (active?.name === from) writeActive({ ...active, name: to }, p)

      process.stdout.write(`Renamed profile '${from}' to '${to}'.\n`)
    })

  program
    .command('remove <name>')
    .description('delete a profile, its secret and isolated dir')
    .action(async (name: string) => {
      if (!profileExists(name, p)) throw new Error(`Unknown profile: ${name}. See: ccswitch list`)
      const profile = loadProfile(name, p)
      await deleteSecret(name, plat, p)
      await deleteSecret(name, plat, p, { slot: 'token' })
      if (profile.configDir && existsSync(profile.configDir)) rmSync(profile.configDir, { recursive: true, force: true })
      removeProfile(name, p)
      process.stdout.write(`Removed profile '${name}'.\n`)
    })

  program
    .command('doctor')
    .description('check that live state matches the active-profile pointer')
    .action(async () => {
      const active = readActive(p)
      const activeName = active?.name
      const profiles = listProfiles(p)
      const profileStates: Record<string, ProfileState> = {}
      for (const prof of profiles) {
        const secretSlot = prof.type === 'bedrock' ? null : 'secret'
        const secret = secretSlot === null ? null : await getSecret(prof.name, plat, p)
        const isActiveKey = prof.name === activeName && (prof.type === 'api-key' || prof.type === 'bedrock-key')
        profileStates[prof.name] = {
          hasSecret: secret !== null,
          hasToken: prof.type === 'login' ? (await getSecret(prof.name, plat, p, { slot: 'token' })) !== null : false,
          configDirExists: prof.configDir ? existsSync(prof.configDir) : false,
          ...(isActiveKey && secret !== null ? { secretPreview: secret } : {}),
        }
      }
      const snap: DoctorSnapshot = {
        profiles,
        active,
        settings: loadSettings(p.settingsFile),
        liveCredentialPresent: (await readLiveCredential(plat, p)) !== null,
        profileStates,
        now: new Date(),
      }
      const findings = diagnose(snap)
      const icon = { ok: '✓', warn: '!', error: '✗' } as const
      for (const f of findings) process.stdout.write(`${icon[f.level]} ${f.message}\n`)

      process.stdout.write('\n')
      for (const line of describeActive(snap)) process.stdout.write(`${line}\n`)

      const errors = findings.filter((f) => f.level === 'error').length
      const warnCount = findings.filter((f) => f.level === 'warn').length
      process.stdout.write(`\n${errors} error(s), ${warnCount} warning(s).\n`)
      if (errors > 0) throw new Error('doctor found problems')
    })

  program
    .command('shellinit')
    .description('print a shell function (ccuse) for convenience')
    .action(() => {
      process.stdout.write(
        [
          'ccuse() {',
          '  if [ "$1" = "--unset" ]; then eval "$(ccswitch env --unset)"; return; fi',
          '  eval "$(ccswitch env "$1")"',
          '}',
        ].join('\n') + '\n',
      )
    })

  program
    .command('save <name>')
    .requiredOption('--type <type>', 'login | api-key | bedrock')
    .option('--force', 'overwrite existing profile')
    .description('snapshot current live state into a profile')
    .action(async (name: string, opts: { type: string; force?: boolean }) => {
      assertValidProfileName(name)
      if (!isAuthType(opts.type)) throw new Error(`Invalid --type '${opts.type}'`)
      if (profileExists(name, p) && !opts.force) throw new Error(`Profile '${name}' exists. Use --force.`)
      const profile: Profile = { name, type: opts.type, env: {} }
      if (opts.type === 'login') {
        const cred = await readLiveCredential(plat, p)
        if (!cred) throw new Error('No live login found. Run /login in Claude Code first.')
        const credHash = hashCredential(cred)
        const dup = findDuplicateLoginName(credHash, listProfiles(p), name)
        if (dup && !opts.force) {
          throw new Error(
            `This credential is identical to profile '${dup}' — you probably didn't log in as a different account. ` +
            `Log in as the intended account first, or re-run with --force.`,
          )
        }
        await setSecret(name, cred, plat, p)
        profile.credHash = credHash
        const account = readOAuthAccount(p)
        if (account != null) profile.oauthAccount = account
      } else if (opts.type === 'api-key') {
        const settings = loadSettings(p.settingsFile)
        const key = settings?.env?.ANTHROPIC_API_KEY
        if (!key) throw new Error('No ANTHROPIC_API_KEY in settings to snapshot.')
        await setSecret(name, key, plat, p)
      } else if (opts.type === 'bedrock-key') {
        const token = env.AWS_BEARER_TOKEN_BEDROCK
        if (!token) throw new Error('No AWS_BEARER_TOKEN_BEDROCK in environment to snapshot.')
        await setSecret(name, token, plat, p)
        profile.env = { CLAUDE_CODE_USE_BEDROCK: '1', ...(env.AWS_REGION ? { AWS_REGION: env.AWS_REGION } : {}) }
        const exp = deriveBedrockKeyExpiry(token)
        if (exp) profile.credExpiresAt = exp
      } else {
        const settings = loadSettings(p.settingsFile)
        profile.env = {
          CLAUDE_CODE_USE_BEDROCK: settings?.env?.CLAUDE_CODE_USE_BEDROCK ?? '1',
          AWS_PROFILE: settings?.env?.AWS_PROFILE ?? '',
          AWS_REGION: settings?.env?.AWS_REGION ?? '',
        }
      }
      saveProfile(profile, p)
      process.stdout.write(`Saved profile '${name}'.\n`)
    })

  program
    .command('token <name>')
    .description('capture a long-lived OAuth token for a login profile')
    .action(async (name: string) => {
      if (!profileExists(name, p)) throw new Error(`Unknown profile: ${name}. See: ccswitch list`)
      const profile = loadProfile(name, p)
      if (profile.type !== 'login') throw new Error(`Profile '${name}' is not a login profile.`)
      const token = await captureOAuthToken()
      await setSecret(name, token, plat, p, { slot: 'token' })
      saveProfile({ ...profile, hasToken: true, tokenCapturedAt: new Date().toISOString() }, p)
      process.stdout.write(`Captured OAuth token for '${name}'. Per-shell login now works.\n`)
    })

  program
    .command('refresh <name>')
    .option('--token <token>', 'bearer token to store (else read AWS_BEARER_TOKEN_BEDROCK from the environment)')
    .description('replace a bedrock-key profile\'s token in place and re-derive its expiry')
    .action(async (name: string, opts: { token?: string }) => {
      if (!profileExists(name, p)) throw new Error(`Unknown profile: ${name}. See: ccswitch list`)
      const profile = loadProfile(name, p)
      if (profile.type !== 'bedrock-key') {
        throw new Error(`Profile '${name}' is not a bedrock-key profile; refresh only applies to bedrock-key.`)
      }
      const token = opts.token ?? env.AWS_BEARER_TOKEN_BEDROCK
      if (!token) throw new Error('No token to store. Pass --token <t> or set AWS_BEARER_TOKEN_BEDROCK.')
      await setSecret(name, token, plat, p)
      const exp = deriveBedrockKeyExpiry(token)
      const updated: Profile = { ...profile }
      if (exp) updated.credExpiresAt = exp
      else delete updated.credExpiresAt   // new token isn't short-term → clear stale expiry
      saveProfile(updated, p)
      const badge = exp ? ` (expires ${exp.slice(0, 16).replace('T', ' ')} UTC)` : ''
      process.stdout.write(`Refreshed Bedrock token for '${name}'.${badge}\n`)
    })

  program
    .command('add')
    .option('--force', 'overwrite existing profile')
    .description('guided setup (login / api-key / bedrock)')
    .action(async (opts: { force?: boolean }) => {
      const name = (await clack.text({ message: 'Profile name' })) as string
      if (clack.isCancel(name)) return
      assertValidProfileName(name)
      if (profileExists(name, p) && !opts.force) throw new Error(`Profile '${name}' exists. Use --force.`)
      const type = (await clack.select({
        message: 'Auth type',
        options: [
          { value: 'login', label: 'Subscription login (OAuth)' },
          { value: 'api-key', label: 'API key' },
          { value: 'bedrock', label: 'Bedrock (AWS credentials)' },
          { value: 'bedrock-key', label: 'Bedrock API key' },
        ],
      })) as string
      if (clack.isCancel(type) || !isAuthType(type)) return
      const profile: Profile = { name, type, env: {} }
      if (type === 'api-key') {
        const key = (await clack.password({ message: 'ANTHROPIC_API_KEY' })) as string
        if (clack.isCancel(key)) return
        await setSecret(name, key, plat, p)
      } else if (type === 'bedrock-key') {
        const token = (await clack.password({ message: 'AWS_BEARER_TOKEN_BEDROCK (Bedrock API key)' })) as string
        if (clack.isCancel(token)) return
        const region = (await clack.text({ message: 'AWS_REGION (optional)' })) as string
        if (clack.isCancel(region)) return
        await setSecret(name, token, plat, p)
        profile.env = { CLAUDE_CODE_USE_BEDROCK: '1', ...(region ? { AWS_REGION: region } : {}) }
        const exp = deriveBedrockKeyExpiry(token)
        if (exp) profile.credExpiresAt = exp
      } else if (type === 'bedrock') {
        const awsProfile = (await clack.text({ message: 'AWS_PROFILE' })) as string
        const region = (await clack.text({ message: 'AWS_REGION' })) as string
        profile.env = { CLAUDE_CODE_USE_BEDROCK: '1', AWS_PROFILE: awsProfile, AWS_REGION: region }
      } else {
        clack.log.info(`Launching 'claude auth login' — sign in as the account for '${name}'.`)
        const result = await captureLogin({
          profileName: name,
          profiles: listProfiles(p),
          runInteractive: (cmd, args) => runInteractive(cmd, args),
          readAuthStatus: () => readAuthStatus(),
          readLiveCredential: () => readLiveCredential(plat, p),
          writeLiveCredential: (value) => writeLiveCredential(value, plat, p),
          neutralizeLiveCredential: () => neutralizeLiveCredential(plat, p),
          setSecret: (value) => setSecret(name, value, plat, p),
          confirmDuplicate: async (dupName) => {
            const proceed = await clack.confirm({
              message: `This credential is identical to profile '${dupName}' — you probably didn't log in as a different account. Store it anyway?`,
              initialValue: false,
            })
            return !clack.isCancel(proceed) && proceed === true
          },
          afterCapture: async () => {
            const wantToken = await clack.confirm({ message: 'Capture OAuth token for per-shell use?', initialValue: false })
            if (wantToken === true) {
              try {
                const token = await captureOAuthToken()
                await setSecret(name, token, plat, p, { slot: 'token' })
                profile.hasToken = true
                profile.tokenCapturedAt = new Date().toISOString()
              } catch (err: any) {
                process.stderr.write(`Warning: OAuth token capture skipped: ${err?.message ?? err}\n`)
              }
            }
          },
        })
        if (result == null) return
        profile.credHash = result.credHash
        const account = readOAuthAccount(p)
        if (account != null) profile.oauthAccount = account
      }
      const isolate = await clack.confirm({ message: 'Isolate config (separate settings/history/MCP)? Takes effect per-shell only (ccuse), not on global switch.', initialValue: false })
      if (isolate === true) {
        profile.configDir = path.join(p.homesDir, name)
        mkdirSync(profile.configDir, { recursive: true })
        if (existsSync(p.claudeConfigDir)) {
          try {
            cpSync(p.claudeConfigDir, profile.configDir, {
              recursive: true,
              filter: (src) => path.basename(src) !== '.credentials.json',
            })
          } catch (err: any) {
            process.stderr.write(`Warning: failed to seed isolated config dir: ${err?.message ?? err}\n`)
          }
        }
      }
      saveProfile(profile, p)
      process.stdout.write(`Added profile '${name}'.\n`)
    })

  // Bare name → global switch (default command).
  program
    .argument('[name]', 'profile to switch to globally')
    .action(async (name: string | undefined) => {
      let target = name
      if (!target) {
        const profiles = listProfiles(p)
        if (profiles.length === 0) { process.stdout.write('No profiles. Add one with: ccswitch add\n'); return }
        const picked = await clack.select({
          message: 'Switch to',
          options: profiles.map((prof) => ({ value: prof.name, label: `${prof.name} (${prof.type})` })),
        })
        if (clack.isCancel(picked)) return
        target = picked as string
      }
      if (!profileExists(target, p)) throw new Error(`Unknown profile: ${target}. See: ccswitch list`)
      const profile = loadProfile(target, p)
      const result = await globalSwitch(profile, {
        plat, paths: p, now: nowIso(),
        loadSettings, saveSettings, getSecret,
        writeLiveCredential, neutralizeLiveCredential,
        readActive, writeActive,
        writeApiKeyHelper: (prof) => buildApiKeyHelperCommand(prof, plat, p),
        loadProfile, readLiveCredential, setSecret,
        readOAuthAccount, writeOAuthAccount, saveProfile,
      })
      process.stdout.write(`Switched to '${target}'. Restart desktop app / IDE to pick up the change.\n`)
      if (result.warning) {
        process.stderr.write(`\nWarning: ${result.warning}\n`)
      }
    })

  try {
    await program.parseAsync(argv, { from: 'user' })
    return 0
  } catch (err: any) {
    if (err.code === 'commander.version' || err.code === 'commander.helpDisplayed') return 0
    process.stderr.write(String(err?.message ?? err) + '\n')
    return 1
  }
}
