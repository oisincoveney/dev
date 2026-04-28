/**
 * `oisin-dev update`
 *
 * Re-syncs generated files (hook scripts, .claude/docs/ fragments, settings)
 * from the existing .dev.config.json without running prompts and without
 * touching user-customised files (lefthook.yml, lint configs).
 */

import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import * as p from '@clack/prompts'
import { readConfig } from './config.js'
import { applyDeleteriousMigrations, installAll } from './install.js'

const RETIRED_HOOK_FILES = [
  '.claude/hooks/verify-grounding.sh',
  '.codex/hooks/verify-grounding.sh',
]

function pruneRetiredHookFiles(cwd: string, log: (msg: string) => void): void {
  for (const rel of RETIRED_HOOK_FILES) {
    const path = join(cwd, rel)
    if (existsSync(path)) {
      rmSync(path)
      log(`removed orphan: ${rel}`)
    }
  }
}

export async function runUpdate(): Promise<void> {
  p.intro('@oisincoveney/dev update')

  const cwd = process.cwd()
  const config = readConfig(cwd)

  if (!config) {
    p.log.error('No .dev.config.json found. Run `init` first.')
    process.exit(1)
  }

  if (existsSync(join(cwd, '.claude', 'docs'))) {
    p.log.warn(
      'Detected legacy `.claude/docs/` directory. Instructions now live in `.claude/rules/` — review any custom edits, then delete `.claude/docs/`.',
    )
  }

  p.log.info(`Re-syncing ${config.variant} project from .dev.config.json`)

  pruneRetiredHookFiles(cwd, (msg) => p.log.info(msg))

  const migration = applyDeleteriousMigrations(cwd)
  for (const path of migration.removed) p.log.info(`removed orphan: ${path}`)
  for (const file of migration.trimmed) p.log.info(`trimmed BEADS INTEGRATION block: ${file}`)
  for (const field of migration.configFieldsStripped) {
    p.log.info(`stripped removed config field: ${field}`)
  }
  if (migration.constitutionSeeded > 0) {
    p.log.info(`seeded ${migration.constitutionSeeded} constitution decision(s)`)
  }
  for (const warning of migration.warnings) p.log.warn(warning)

  const acceptLefthook = process.argv.includes('--accept-lefthook-overwrite')

  const spinner = p.spinner()
  spinner.start('Updating hooks, docs, and settings')
  const result = await installAll(cwd, config, {} as never, {
    skipSideEffects: true,
    isUpdate: true,
    acceptLefthookOverwrite: acceptLefthook,
  })
  spinner.stop('Done')

  if (result.manifest) {
    if (result.manifest.lefthookDrift && !acceptLefthook) {
      p.log.error(
        'lefthook.yml has drifted from what we shipped. Halting update.\n' +
          '  - To accept the new lefthook.yml (overwrite yours): re-run with --accept-lefthook-overwrite\n' +
          '  - To keep your version and update the manifest to match: run `oisin-dev accept-lefthook`\n' +
          '  - Otherwise diff and reconcile manually before re-running update.',
      )
      process.exit(1)
    }

    if (result.manifest.devNew.length > 0) {
      p.log.warn(
        `Drifted files; new versions written next to yours: ${result.manifest.devNew.join(', ')}. Diff and reconcile.`,
      )
    }

    if (result.manifest.removed.length > 0) {
      p.log.info(`Removed retired files: ${result.manifest.removed.join(', ')}.`)
    }
  }

  p.outro('Commit the updated files.')
}
