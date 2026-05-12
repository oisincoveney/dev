#!/usr/bin/env node
import { runBeadsMigrate } from './beads-migrate.js'
import { runHookDispatcher } from './hooks/dispatch.js'
import { runInit } from './init.js'
import { runReset } from './reset.js'
import { runTicketsUi } from './tickets-ui.js'
import { runTracker } from './tracker.js'
import { runUpdate } from './update.js'

const COMMANDS: Record<string, string> = {
  init:             'Initialize an opinionated dev environment in the current (or new) project',
  update:           'Non-destructively refresh generated files through Copier',
  reset:            'Dangerously delete and recreate generated agent configuration',
  'beads-migrate':   'Adopt repo-backed Dolt sync for Beads without Git-tracking issues.jsonl',
  tickets:           'Launch the local Beads UI for the current workspace',
  tracker:           'Normalized tracker shim (beads adapter first)',
  hook:             'Run a TS-native hook handler (internal — invoked by Claude Code)',
  help:             'Show this help message',
}

function printHelp(): void {
  // CLI help is stdout, not a runtime log.
  process.stdout.write(`
@oisincoveney/dev — Opinionated AI dev environment

Usage:
  npx @oisincoveney/dev <command> [flags]

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
    case 'beads-migrate':
      runBeadsMigrate()
      break
    case 'tickets':
      runTicketsUi(process.argv.slice(3))
      break
    case 'tracker':
      try {
        runTracker(process.argv.slice(3))
      } catch (err) {
        process.stderr.write(`tracker: ${err instanceof Error ? err.message : String(err)}\n`)
        process.exit(1)
      }
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
