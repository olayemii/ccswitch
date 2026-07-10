import { Command } from 'commander'
import path from 'node:path'
import { getPlatform, paths } from './platform.js'
import { listProfiles, loadProfile, readActive, removeProfile, profileExists, writeActive, assertValidProfileName } from './profiles.js'
import { getSecret, deleteSecret } from './secretStore.js'
import { buildEnvExport, buildEnvUnset } from './envexport.js'
import { loadSettings, saveSettings } from './settings.js'
import { writeLiveCredential, neutralizeLiveCredential } from './credentials.js'
import { buildApiKeyHelperCommand, captureOAuthToken } from './helpers.js'
import { globalSwitch } from './switch.js'
import { rmSync, existsSync, mkdirSync, cpSync } from 'node:fs'
import * as clack from '@clack/prompts'
import { setSecret } from './secretStore.js'
import { readLiveCredential } from './credentials.js'
import { saveProfile } from './profiles.js'
import { isAuthType, type Profile, type Platform } from './types.js'

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
      for (const prof of profiles) {
        const mark = prof.name === active ? '* ' : '  '
        process.stdout.write(`${mark}${prof.name} (${prof.type})\n`)
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
      process.stdout.write(buildEnvExport(profile, secret) + '\n')
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
        await setSecret(name, cred, plat, p)
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
      saveProfile({ ...profile, hasToken: true }, p)
      process.stdout.write(`Captured OAuth token for '${name}'. Per-shell login now works.\n`)
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
      } else if (type === 'bedrock') {
        const awsProfile = (await clack.text({ message: 'AWS_PROFILE' })) as string
        const region = (await clack.text({ message: 'AWS_REGION' })) as string
        profile.env = { CLAUDE_CODE_USE_BEDROCK: '1', AWS_PROFILE: awsProfile, AWS_REGION: region }
      } else {
        const cred = await readLiveCredential(plat, p)
        if (!cred) throw new Error('No live login found. Run /login first, then re-run add.')
        await setSecret(name, cred, plat, p)
        const wantToken = await clack.confirm({ message: 'Capture OAuth token for per-shell use?', initialValue: false })
        if (wantToken === true) {
          const token = await captureOAuthToken()
          await setSecret(name, token, plat, p, { slot: 'token' })
          profile.hasToken = true
        }
      }
      const isolate = await clack.confirm({ message: 'Isolate config (separate settings/history/MCP)?', initialValue: false })
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
      await globalSwitch(profile, {
        plat, paths: p, now: nowIso(),
        loadSettings, saveSettings, getSecret,
        writeLiveCredential, neutralizeLiveCredential,
        readActive, writeActive,
        writeApiKeyHelper: (prof) => buildApiKeyHelperCommand(prof, plat, p),
        loadProfile, readLiveCredential, setSecret,
      })
      process.stdout.write(`Switched to '${target}'. Restart desktop app / IDE to pick up the change.\n`)
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
