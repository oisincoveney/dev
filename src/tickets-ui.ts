import { spawnSync } from 'node:child_process'

const BEADS_UI_PACKAGE = 'beads-ui'
const BEADS_UI_BIN = 'bdui'

export interface TicketsUiCommand {
  command: string
  args: string[]
}

export function buildTicketsUiCommand(argv: ReadonlyArray<string>): TicketsUiCommand {
  const args = ['--package', BEADS_UI_PACKAGE, BEADS_UI_BIN]
  const hasCommand = argv.some((arg) => arg === 'start' || arg === 'stop' || arg === 'restart')
  if (!hasCommand) {
    args.push('start')
  }
  args.push(...argv)
  return { command: 'bunx', args }
}

export function printTicketsUiHelp(): void {
  process.stdout.write(`
@oisincoveney/dev tickets — Local Beads UI

Usage:
  bunx @oisincoveney/dev tickets [flags]
  bunx @oisincoveney/dev tickets stop
  bunx @oisincoveney/dev tickets restart [flags]

This delegates to beads-ui, a local web UI for the bd CLI.

Common flags:
  --open             Open the browser after starting
  --host <host>      Bind address passed to beads-ui
  --port <port>      Port passed to beads-ui
  --debug            Enable beads-ui debug logging

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
    process.stderr.write(`Failed to launch beads-ui via bunx: ${result.error.message}\n`)
    process.exit(1)
  }

  if (typeof result.status === 'number') {
    process.exit(result.status)
  }

  process.exit(1)
}
