/**
 * `oisin-dev statusline` — zero-token status for Claude Code's status bar.
 * One line: <variant> · <workflow> · ⎇ <branch> · ready:<n>
 */

import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

interface DevConfig {
  variant?: string
  workflow?: string
}

function readConfig(): DevConfig {
  if (!existsSync('.dev.config.json')) return {}
  try {
    return JSON.parse(readFileSync('.dev.config.json', 'utf8')) as DevConfig
  } catch {
    return {}
  }
}

function gitBranch(): string {
  const r = spawnSync('git', ['branch', '--show-current'], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : ''
}

function bdReadyCount(): number {
  const r = spawnSync('bd', ['ready'], { encoding: 'utf8' })
  if (r.status !== 0 || !r.stdout) return 0
  return r.stdout.split('\n').filter(Boolean).length
}

export function runStatusline(): void {
  const config = readConfig()
  const parts: string[] = []

  if (config.variant) parts.push(config.variant)
  if (config.workflow && config.workflow !== 'none') parts.push(config.workflow)

  const branch = gitBranch()
  if (branch) parts.push(`⎇ ${branch}`)

  try {
    const count = bdReadyCount()
    if (count > 0) parts.push(`ready:${count}`)
  } catch {
    // bd not available
  }

  process.stdout.write(parts.join(' · ') + '\n')
}
