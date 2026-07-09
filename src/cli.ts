import { Command } from 'commander'

export async function runCli(argv: string[]): Promise<number> {
  const program = new Command()
  program.name('ccswitch').version('0.1.0').exitOverride()
  try {
    await program.parseAsync(argv, { from: 'user' })
    return 0
  } catch (err: any) {
    // commander throws on --version/--help with a benign code via exitOverride
    if (err.code === 'commander.version' || err.code === 'commander.helpDisplayed') return 0
    process.stderr.write(String(err?.message ?? err) + '\n')
    return 1
  }
}
