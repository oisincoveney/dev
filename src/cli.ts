#!/usr/bin/env node
import { runHookDispatcher } from './hooks/dispatch.js'
import { runBeadsToBacklog } from './beads-to-backlog.js'
import { runDoctor } from './doctor.js'
import { runGenerate } from './generate.js'
import { runInit } from './init.js'
import { runReset } from './reset.js'
import { runTicketsUi } from './tickets-ui.js'
import { runUpdate } from './update.js'

const COMMANDS: Record<string, string> = {
  init:             'Initialize an opinionated dev environment in the current (or new) project',
  update:           'Non-destructively refresh generated harness files',
  reset:            'Dangerously delete and recreate generated agent configuration',
  generate:         'Regenerate harness files from saved project state',
  doctor:           'Validate generated harness files and workflow wiring',
  'beads-to-backlog': 'Import existing Beads tickets into Backlog.md task files',
  tickets:           'Launch the local Backlog.md UI for the current workspace',
  hook:             'Run a TS-native hook handler (internal — invoked by Claude Code)',
  help:             'Show this help message',
}

function printHelp(): void {
  // CLI help is stdout, not a runtime log.
  process.stdout.write(`
@oisincoveney/dev — Opinionated AI dev environment

Usage:
  bunx @oisincoveney/dev <command> [flags]

Commands:
${Object.entries(COMMANDS)
  .map(([cmd, desc]) => `  ${cmd.padEnd(10)} ${desc}`)
  .join('\n')}

Reset flags:
  --yes                         Skip the interactive reset confirmation.
  --force                       Bypass the clean-worktree guard.

`)
}

async function main(): Promise<void> {
  const command = process.argv[2]

  switch (command) {
    case 'init':
      await runInit()
      break
    case 'update':
      await runUpdate()
      break
    case 'reset':
      await runReset()
      break
    case 'generate':
      runGenerate(process.argv.slice(3))
      break
    case 'doctor':
      runDoctor(process.argv.slice(3))
      break
    case 'beads-to-backlog':
      runBeadsToBacklog(process.argv.slice(3))
      break
    case 'tickets':
      runTicketsUi(process.argv.slice(3))
      break
    case 'hook': {
      const handlerName = process.argv[3]
      if (handlerName === undefined || handlerName.length === 0) {
        process.stderr.write('Usage: oisin-dev hook <name>\n')
        process.exit(1)
      }
      await runHookDispatcher(handlerName)
      break
    }
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      printHelp()
      break
    default:
      console.error(`Unknown command: ${command}`)
      printHelp()
      process.exit(1)
  }
}

void main()
