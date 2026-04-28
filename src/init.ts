/**
 * `oisin-dev init`
 *
 * Configures AI agents, coding standards, and dev tools in the current directory.
 * Works whether or not a project manifest exists — prompts fill in what detection
 * can't determine.
 */

import { writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import * as p from '@clack/prompts'
import { type DevConfig, configPath, writeConfig } from './config.js'
import { detectProject } from './detect.js'
import {
  installAll,
  removeLegacyRetiredPaths,
  seedConstitutionDecisions,
  stripLegacyConfigFields,
  trimBeadsIntegrationOnAgentDocs,
} from './install.js'
import type { SuperDriftEntry } from './manifest.js'
import { type Answers, runPrompts } from './prompts.js'

export async function runInit(): Promise<void> {
  p.intro('@oisincoveney/dev')

  const cwd = process.cwd()
  const detected = detectProject(cwd)

  if (detected.language !== null) {
    p.log.info(`Detected ${detected.language} project in ${basename(cwd)}. Configuring in place.`)
  } else if (detected.isEmpty) {
    p.log.info(`Empty directory ${basename(cwd)}. Configuring in place.`)
  } else {
    p.log.info(`No project manifest detected in ${basename(cwd)}. Configuring in place.`)
  }

  const answers = await runPrompts(detected)
  await writeConfigAndInstall(cwd, answers)
  p.outro('Done.')
}

// Default banned sycophancy / deflection phrases. Users can edit or clear
// .bannedWords in .dev.config.json — these are just an opinionated starting set
// enforced by templates/hooks/banned-words-guard.sh (a Stop hook).
const DEFAULT_BANNED_WORDS: ReadonlyArray<string> = [
  // Sycophancy / padding
  "you're absolutely right",
  'you are absolutely right',
  'great question',
  'excellent question',
  'perfect!',
  // Deflection
  'pre-existing issue',
  'pre-existing failure',
  'unrelated failing test',
  // Unverified completion claims
  'should work',
  'this works',
  // Follow-up / permission-asking prompts — the response must state the next
  // step or stop. Asking the user what to do next is unproductive.
  'want me to',
  'would you like',
  'should i',
  'shall i',
  'do you want',
  'let me know if',
  "if you'd like",
  'if you want',
  'happy to',
]

async function writeConfigAndInstall(dir: string, answers: Answers): Promise<void> {
  const config: DevConfig = {
    language: answers.language,
    variant: answers.variant,
    framework: answers.framework,
    packageManager: answers.packageManager,
    commands: answers.commands,
    skills: answers.skills,
    tools: answers.tools,
    workflow: answers.workflow,
    contractDriven: answers.contractDriven,
    targets: answers.targets,
    models: answers.models,
    bannedWords: DEFAULT_BANNED_WORDS,
  }

  writeConfig(dir, config)
  p.log.success(`Wrote ${configPath(dir)}`)

  const legacy = removeLegacyRetiredPaths(dir)
  for (const path of legacy.removed) p.log.info(`removed orphan: ${path}`)
  for (const warning of legacy.warnings) p.log.warn(warning)

  const trimmed = trimBeadsIntegrationOnAgentDocs(dir)
  for (const file of trimmed) p.log.info(`trimmed BEADS INTEGRATION block: ${file}`)

  const stripped = stripLegacyConfigFields(dir)
  for (const field of stripped) p.log.info(`stripped removed config field: ${field}`)

  if (config.tools.includes('beads') && config.workflow === 'bd') {
    const seed = seedConstitutionDecisions(dir, config)
    if (seed.ok && seed.created > 0) {
      p.log.info(`seeded ${seed.created} constitution decision(s)`)
    }
  }

  const spinner = p.spinner()
  spinner.start('Installing hooks, configs, skills, and instruction files')
  const result = await installAll(dir, config, answers)
  spinner.stop('Installed')

  if (result.manifest) {
    if (result.manifest.lefthookDrift) {
      p.log.error(
        'lefthook.yml has drifted from what we shipped. Halting init — diff your version against the new one, reconcile, then re-run.',
      )
      process.exit(1)
    }

    for (const entry of result.manifest.superDriftedDetails) {
      await resolveSuperDrift(dir, entry)
    }

    if (result.manifest.backups.length > 0) {
      p.log.info(
        `Backed up customized files to .user-backup: ${result.manifest.backups.join(', ')}.`,
      )
    }

    if (result.manifest.removed.length > 0) {
      p.log.info(`Removed retired files: ${result.manifest.removed.join(', ')}.`)
    }
  }
}

async function resolveSuperDrift(dir: string, entry: SuperDriftEntry): Promise<void> {
  const choice = await p.select<'keep' | 'take' | 'abort'>({
    message: `${entry.relPath} is super-drifted (heavily modified). What do you want to do?`,
    options: [
      { value: 'keep', label: 'Keep my version (skip overwrite)' },
      { value: 'take', label: 'Take the new version (back mine up to .user-backup)' },
      { value: 'abort', label: 'Abort init — I want to review first' },
    ],
  })

  if (choice === 'abort' || p.isCancel(choice)) {
    p.log.warn(`Aborting at ${entry.relPath}. Re-run init when ready.`)
    process.exit(1)
  }

  if (choice === 'take') {
    const absPath = join(dir, entry.relPath)
    writeFileSync(`${absPath}.user-backup`, entry.currentContent)
    writeFileSync(absPath, entry.newContent)
    p.log.info(`Took new version of ${entry.relPath}; your old version is at ${entry.relPath}.user-backup.`)
  } else {
    p.log.info(`Kept your version of ${entry.relPath}. New shipped version is NOT applied.`)
  }
}
