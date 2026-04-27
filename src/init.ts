/**
 * `oisin-dev init`
 *
 * Configures AI agents, coding standards, and dev tools in the current directory.
 * Works whether or not a project manifest exists — prompts fill in what detection
 * can't determine.
 */

import { basename } from 'node:path'
import * as p from '@clack/prompts'
import { type DevConfig, configPath, writeConfig } from './config.js'
import { detectProject } from './detect.js'
import { applyDeleteriousMigrations, installAll } from './install.js'
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

  const migration = applyDeleteriousMigrations(dir)
  for (const path of migration.removed) p.log.info(`removed orphan: ${path}`)
  for (const file of migration.trimmed) p.log.info(`trimmed BEADS INTEGRATION block: ${file}`)
  for (const field of migration.configFieldsStripped) {
    p.log.info(`stripped removed config field: ${field}`)
  }
  for (const warning of migration.warnings) p.log.warn(warning)

  const spinner = p.spinner()
  spinner.start('Installing hooks, configs, skills, and instruction files')
  await installAll(dir, config, answers)
  spinner.stop('Installed')
}
