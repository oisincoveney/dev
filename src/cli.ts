#!/usr/bin/env node
import { runAcceptLefthook } from './accept-lefthook.js'
import { runBeadsMigrate } from './beads-migrate.js'
import { runHookDispatcher } from './hooks/dispatch.js'
import { runInit } from './init.js'
import { runSetCommands } from './set-commands.js'
import { runUpdate } from './update.js'

const COMMANDS: Record<string, string> = {
  init:             'Initialize an opinionated dev environment in the current (or new) project',
  update:           'Re-sync generated files (hooks, docs, settings) from .dev.config.json',
  'set-commands':   'Fill in or update dev/build/test/typecheck/lint/format commands',
  'accept-lefthook': "Mark the current lefthook.yml as canonical (clears manifest drift warning)",
  'beads-migrate':   'Adopt repo-backed Dolt sync for Beads without Git-tracking issues.jsonl',
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

Update flags (polyglot projects):
  --reconfigure-languages       Re-prompt the variants multiselect.
  --languages=<v1>,<v2>...      Set variants explicitly (e.g. ts-library,go-bin).
  --add-language=<variant>      Append a variant. Repeatable.
  --remove-language=<variant>   Drop a variant. Repeatable.

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
    case 'set-commands':
      await runSetCommands()
      break
    case 'accept-lefthook':
      await runAcceptLefthook()
      break
    case 'beads-migrate':
      runBeadsMigrate()
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
