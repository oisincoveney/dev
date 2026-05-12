/**
 * `oisin-dev update`
 *
 * Non-destructively applies the Copier update path, then refreshes dotagents
 * skill links and lefthook. Use `oisin-dev reset` for the dangerous path.
 */

import * as p from '@clack/prompts'
import { runUpdateOrchestration, STATE_FILE } from './orchestrator.js'
import { gitWorktreeClean } from './reset.js'

export async function runUpdate(): Promise<void> {
  p.intro('@oisincoveney/dev update')
  const cwd = process.cwd()
  const clean = gitWorktreeClean(cwd)
  if (!clean.ok) {
    p.log.error(clean.message)
    process.exit(1)
  }

  const spinner = p.spinner()
  spinner.start(`Applying Copier update from ${STATE_FILE}`)
  const result = runUpdateOrchestration(cwd)
  if (!result.ok) {
    spinner.stop('Failed')
    p.log.error(result.message)
    process.exit(1)
  }
  spinner.stop('Updated')
  p.outro('Commit the updated files.')
}
