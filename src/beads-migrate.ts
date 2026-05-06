import * as p from '@clack/prompts'
import { migrateBeadsRepoBackedDolt } from './install.js'

export function runBeadsMigrate(): void {
  p.intro('@oisincoveney/dev beads-migrate')
  const report = migrateBeadsRepoBackedDolt(process.cwd())

  if (report.config.ok) {
    p.log.success('Configured Beads for repo-backed Dolt sync.')
  } else {
    p.log.error(`Beads migration failed: ${report.config.error}`)
    process.exit(1)
  }

  if (report.remoteUrl !== null) {
    p.log.info(`sync.remote, federation.remote, and Dolt origin use ${report.remoteUrl}`)
  } else {
    p.log.warn('No git remote.origin.url found; set one, then re-run this command.')
  }

  if (report.gitignoreUpdated) {
    p.log.info('Added .beads/issues.jsonl to .gitignore.')
  }

  if (report.issuesJsonlTracked && report.issuesJsonlUntracked) {
    p.log.info('Removed .beads/issues.jsonl from Git tracking with git rm --cached.')
  }

  p.outro('Fresh clone flow: git clone, bd bootstrap, bd dolt pull.')
}
