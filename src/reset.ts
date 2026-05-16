import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { gitSubprocessEnv } from './git-env.js'
import * as p from '@clack/prompts'
import { configureBeadsAfterInit } from './install.js'
import { readInternalState, runResetOrchestration } from './orchestrator.js'

export const RESET_PATHS = [
  '.agents',
  '.claude',
  '.codex',
  '.cursor',
  '.opencode',
  'AGENTS.md',
  'CLAUDE.md',
  'agents.toml',
] as const

export interface ResetOptions {
  force?: boolean
  yes?: boolean
  skipExternalTools?: boolean
}

export async function runReset(argv: ReadonlyArray<string> = process.argv.slice(3)): Promise<void> {
  p.intro('@oisincoveney/dev reset')

  const cwd = process.cwd()
  const options = parseResetOptions(argv)

  if (!options.force) {
    const clean = gitWorktreeClean(cwd)
    if (!clean.ok) {
      p.log.error(clean.message)
      process.exit(1)
    }
  }

  const existing = existingResetPaths(cwd)
  if (existing.length === 0) {
    p.log.info('No generated agent paths found to remove.')
  } else {
    p.log.warn(`This will remove: ${existing.join(', ')}`)
  }

  if (!options.yes) {
    const confirmed = await p.confirm({
      message: 'Reset generated agent configuration and root agent docs?',
      initialValue: false,
    })
    if (p.isCancel(confirmed) || confirmed !== true) {
      p.cancel('Reset cancelled.')
      process.exit(0)
    }
  }

  removeResetPaths(cwd)
  const result = runResetOrchestration(cwd, { skipExternalTools: options.skipExternalTools })
  if (!result.ok) {
    p.log.error(result.message)
    process.exit(1)
  }

  const state = readInternalState(cwd)
  if (state?.beads_enabled === true || existsSync(join(cwd, '.beads'))) {
    const configure = configureBeadsAfterInit(cwd)
    if (configure.ok) p.log.success('beads: configured repo-backed workflow')
    else p.log.warn(`beads: post-reset configuration failed (${configure.error})`)
  }

  p.outro('Reset generated agent configuration.')
}

export function parseResetOptions(argv: ReadonlyArray<string>): ResetOptions {
  return {
    force: argv.includes('--force'),
    yes: argv.includes('--yes') || argv.includes('-y'),
    skipExternalTools: argv.includes('--skip-external-tools'),
  }
}

export function existingResetPaths(cwd: string): string[] {
  return RESET_PATHS.filter((relPath) => existsSync(join(cwd, relPath)))
}

export function removeResetPaths(cwd: string): void {
  for (const relPath of RESET_PATHS) {
    const absPath = join(cwd, relPath)
    if (!existsSync(absPath)) continue
    const stat = lstatSync(absPath)
    rmSync(absPath, { recursive: stat.isDirectory(), force: true })
  }
}

export function gitWorktreeClean(cwd: string): { ok: true } | { ok: false; message: string } {
  const inside = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd,
    encoding: 'utf8',
    env: gitSubprocessEnv(),
    stdio: 'pipe',
  })
  if (inside.status !== 0) {
    return {
      ok: false,
      message: 'reset requires a Git worktree. Re-run with --force to bypass this guard.',
    }
  }

  const status = spawnSync('git', ['status', '--porcelain'], {
    cwd,
    encoding: 'utf8',
    env: gitSubprocessEnv(),
    stdio: 'pipe',
  })
  if (status.status !== 0) {
    return { ok: false, message: 'Could not inspect Git status. Re-run with --force to bypass this guard.' }
  }
  if ((status.stdout ?? '').trim().length > 0) {
    return {
      ok: false,
      message: 'reset requires a clean Git worktree. Commit/stash changes or re-run with --force.',
    }
  }
  return { ok: true }
}
