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
  for (const warning of migration.warnings) p.log.warn(warning)

  const spinner = p.spinner()
  spinner.start('Updating hooks, docs, and settings')
  await installAll(cwd, config, {} as never, {
    skipSideEffects: true,
    isUpdate: true,
  })
  spinner.stop('Done')

  p.outro('Commit the updated files.')
}
