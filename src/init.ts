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
import { installAll } from './install.js'
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
  }

  writeConfig(dir, config)
  p.log.success(`Wrote ${configPath(dir)}`)

  const spinner = p.spinner()
  spinner.start('Installing hooks, configs, skills, and instruction files')
  await installAll(dir, config, answers)
  spinner.stop('Installed')
}
