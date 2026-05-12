/**
 * `oisin-dev init`
 *
 * Configures AI agents, coding standards, Beads, and dev tooling in the
 * current directory. Copier renders files, dotagents syncs skills, and mise
 * installs/runs those tools so users do not need global binaries.
 */

import { basename } from 'node:path'
import * as p from '@clack/prompts'
import type { DevConfig } from './config.js'
import { detectProject } from './detect.js'
import {
  configureBeadsAfterInit,
  installBeadsCli,
  installBeadsPlugin,
  seedConstitutionDecisions,
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

  await configureBeadsIfEnabled(cwd, configFromAnswers(answers))
  p.outro('Done.')
}

async function configureBeadsIfEnabled(dir: string, config: DevConfig): Promise<void> {
  if (!config.tools.includes('beads')) return

  const cliResult = installBeadsCli(dir)
  switch (cliResult.status) {
    case 'created':
      p.log.success('beads: bd init')
      break
    case 'exists':
      p.log.info('beads: .beads/ already exists, skipping bd init')
      break
    case 'no-bd':
      p.log.warn('beads: `bd` not found in PATH. Install bd and rerun Beads setup.')
      break
    case 'failed':
      p.log.warn(`beads: bd init failed (${cliResult.error})`)
      break
  }

  if (cliResult.status === 'created' || cliResult.status === 'exists') {
    const configure = configureBeadsAfterInit(dir)
    if (configure.ok) p.log.success('beads: configured repo-backed workflow')
    else p.log.warn(`beads: post-init configuration failed (${configure.error})`)

    if (config.workflow === 'bd') {
      const seed = seedConstitutionDecisions(dir, config)
      if (seed.ok && seed.created > 0) p.log.info(`seeded ${seed.created} constitution decision(s)`)
    }
  }

  const plugin = installBeadsPlugin(dir)
  if (plugin.status === 'failed') p.log.warn(`beads plugin install failed (${plugin.error})`)
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
