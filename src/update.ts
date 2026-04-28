/**
 * `oisin-dev update`
 *
 * Re-syncs generated files (hook scripts, .claude/docs/ fragments, settings)
 * from the existing .dev.config.json without running prompts and without
 * touching user-customised files (lefthook.yml, lint configs).
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import * as p from '@clack/prompts'
import { readConfig } from './config.js'
import {
  installAll,
  removeLegacyRetiredPaths,
  seedConstitutionDecisions,
  stripLegacyConfigFields,
  trimBeadsIntegrationOnAgentDocs,
} from './install.js'

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

  const legacy = removeLegacyRetiredPaths(cwd)
  for (const path of legacy.removed) p.log.info(`removed orphan: ${path}`)
  for (const warning of legacy.warnings) p.log.warn(warning)

  const trimmed = trimBeadsIntegrationOnAgentDocs(cwd)
  for (const file of trimmed) p.log.info(`trimmed BEADS INTEGRATION block: ${file}`)

  const stripped = stripLegacyConfigFields(cwd)
  for (const field of stripped) p.log.info(`stripped removed config field: ${field}`)

  if (config.tools.includes('beads') && config.workflow === 'bd' && existsSync(join(cwd, '.beads'))) {
    const seed = seedConstitutionDecisions(cwd, config)
    if (seed.ok && seed.created > 0) {
      p.log.info(`seeded ${seed.created} constitution decision(s)`)
    }
  }

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
