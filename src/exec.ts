import { execFile } from 'node:child_process'

export function run(
  cmd: string,
  args: string[],
  opts: { input?: string } = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { encoding: 'utf8' }, (err, stdout, stderr) => {
      const code = err && typeof (err as any).code === 'number' ? (err as any).code : err ? 1 : 0
      resolve({ stdout: stdout ?? '', stderr: stderr ?? '', code })
    })
    if (opts.input !== undefined) {
      child.stdin?.end(opts.input)
    }
  })
}
