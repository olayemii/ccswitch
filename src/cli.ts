import { Command } from 'commander'
import { getPlatform, paths } from './platform.js'
import { listProfiles, loadProfile, readActive, removeProfile, profileExists, writeActive } from './profiles.js'
import { getSecret, deleteSecret } from './secretStore.js'
import { buildEnvExport, buildEnvUnset } from './envexport.js'
import { loadSettings, saveSettings } from './settings.js'
import { writeLiveCredential, neutralizeLiveCredential } from './credentials.js'
import { writeApiKeyHelper } from './helpers.js'
import { globalSwitch } from './switch.js'
import { rmSync, existsSync } from 'node:fs'

function nowIso(): string {
  // Injected-free deterministic-ish timestamp; Date is allowed at runtime (not in workflow scripts).
  return new Date().toISOString().replace(/[:.]/g, '-')
}

export async function runCli(argv: string[]): Promise<number> {
  const program = new Command()
  program.name('ccswitch').version('0.1.0').exitOverride()
  const plat = getPlatform()
  const p = paths(process.env, plat)

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
    .command('env [name]')
    .option('--unset', 'print unset statements')
    .description('print export statements for the current shell')
    .action(async (name: string | undefined, opts: { unset?: boolean }) => {
      if (opts.unset) { process.stdout.write(buildEnvUnset() + '\n'); return }
      if (!name) throw new Error('Usage: ccswitch env <name> | ccswitch env --unset')
      if (!profileExists(name, p)) throw new Error(`Unknown profile: ${name}. See: ccswitch list`)
      const profile = loadProfile(name, p)
      const secret = await getSecret(name, plat, p)
      process.stdout.write(buildEnvExport(profile, secret) + '\n')
    })

  program
    .command('remove <name>')
    .description('delete a profile, its secret and isolated dir')
    .action(async (name: string) => {
      if (!profileExists(name, p)) throw new Error(`Unknown profile: ${name}. See: ccswitch list`)
      const profile = loadProfile(name, p)
      await deleteSecret(name, plat, p)
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

  // Bare name → global switch (default command).
  program
    .argument('[name]', 'profile to switch to globally')
    .action(async (name: string | undefined) => {
      if (!name) { process.stdout.write('Usage: ccswitch <name> | ccswitch list\n'); return }
      if (!profileExists(name, p)) throw new Error(`Unknown profile: ${name}. See: ccswitch list`)
      const profile = loadProfile(name, p)
      await globalSwitch(profile, {
        plat, paths: p, now: nowIso(),
        loadSettings, saveSettings, getSecret,
        writeLiveCredential, neutralizeLiveCredential,
        readActive, writeActive,
        writeApiKeyHelper: (prof, secret) => writeApiKeyHelper(prof, secret, p),
      })
      process.stdout.write(`Switched to '${name}'. Restart desktop app / IDE to pick up the change.\n`)
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
