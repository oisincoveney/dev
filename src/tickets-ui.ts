import { spawnSync } from 'node:child_process'

const BACKLOG_PACKAGE = 'backlog.md'
const BACKLOG_BIN = 'backlog'

export interface TicketsUiCommand {
  command: string
  args: string[]
}

export function buildTicketsUiCommand(argv: ReadonlyArray<string>): TicketsUiCommand {
  const args = ['--package', BACKLOG_PACKAGE, BACKLOG_BIN, 'browser']
  args.push(...argv)
  return { command: 'bunx', args }
}

export function printTicketsUiHelp(): void {
  process.stdout.write(`
@oisincoveney/dev tickets — Local Backlog.md UI

Usage:
  bunx @oisincoveney/dev tickets [flags]

This delegates to Backlog.md's built-in local browser UI.

Common flags:
  --no-open          Do not open the browser automatically
  --port <port>      Port passed to Backlog.md

`)
}

export function runTicketsUi(argv: ReadonlyArray<string>): void {
  if (argv.includes('--help') || argv.includes('-h')) {
    printTicketsUiHelp()
    return
  }

  const { command, args } = buildTicketsUiCommand(argv)
  const result = spawnSync(command, args, { stdio: 'inherit' })

  if (result.error !== undefined) {
    process.stderr.write(`Failed to launch Backlog.md browser via bunx: ${result.error.message}\n`)
    process.exit(1)
  }

  if (typeof result.status === 'number') {
    process.exit(result.status)
  }

  process.exit(1)
}
