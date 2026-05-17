/**
 * `oisin-dev init`
 *
 * Configures AI agents, coding standards, Backlog.md, and dev tooling in the
 * current directory. Copier renders files, dotagents syncs skills, and mise
 * installs/runs those tools so users do not need global binaries.
 */

import { basename } from 'node:path'
import * as p from '@clack/prompts'
import type { DevConfig } from './config.js'
import { detectProject } from './detect.js'
import {
  installBacklogCli,
  seedBacklogConstitutionDecisions,
} from './install.js'
import { runInitOrchestration } from './orchestrator.js'
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
    p.log.info(`No project type detected in ${basename(cwd)}. Configuring in place.`)
  }

  const answers = await runPrompts(detected)
  const spinner = p.spinner()
  spinner.start('Rendering Copier template and syncing agent tooling')
  const result = runInitOrchestration(cwd, answers)
  if (!result.ok) {
    spinner.stop('Failed')
    p.log.error(result.message)
    process.exit(1)
  }
  spinner.stop('Template rendered')

  await configureBacklogIfEnabled(cwd, configFromAnswers(answers))
  p.outro('Done.')
}

async function configureBacklogIfEnabled(dir: string, config: DevConfig): Promise<void> {
  if (!config.tools.includes('backlog')) return

  const cliResult = installBacklogCli(dir)
  switch (cliResult.status) {
    case 'created':
      p.log.success('backlog: initialized')
      break
    case 'exists':
      p.log.info('backlog: existing tracker found, skipping init')
      break
    case 'no-backlog':
      p.log.warn('backlog: `backlog` not found. Run `mise install`, then rerun update.')
      break
    case 'failed':
      p.log.warn(`backlog: init failed (${cliResult.error})`)
      break
  }

  if (cliResult.status === 'created' || cliResult.status === 'exists') {
    const seed = seedBacklogConstitutionDecisions(dir, config)
    if (seed.ok && seed.created > 0) p.log.info(`seeded ${seed.created} constitution decision(s)`)
  }
}

function configFromAnswers(answers: Answers): DevConfig {
  return {
    language: answers.language,
    variant: answers.variant,
    languages: answers.languages,
    variants: answers.variants,
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
}
