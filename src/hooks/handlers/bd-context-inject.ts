/**
 * UserPromptSubmit hook — injects current beads (bd) state into additionalContext.
 *
 * Reports in-progress claimed issues and the top 3 ready issues so the model
 * always has task-tracker state without an explicit `bd list` call. Silent
 * no-op when `bd` is not installed or `.beads/` does not exist in the cwd.
 *
 * Migrated from templates/hooks/bd-context-inject.sh.
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { HookDecision, HookHandler, HookInput } from '../types.js'

interface BdIssue {
  id: string
  priority?: string
  title: string
}

function bdInstalled(): boolean {
  const result = spawnSync('command', ['-v', 'bd'], {
    encoding: 'utf8',
    shell: true,
  })
  return result.status === 0 && !result.error
}

function runBdJson(args: string[], cwd: string): BdIssue[] {
  const result = spawnSync('bd', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0 || result.error) return []
  try {
    return JSON.parse(result.stdout) as BdIssue[]
  } catch {
    return []
  }
}

function formatIssues(issues: BdIssue[]): string {
  return issues
    .map((issue) => `  - ${issue.id} [${issue.priority ?? 'P?'}] ${issue.title}`)
    .join('\n')
}

export const bdContextInject: HookHandler = (input): HookDecision => {
  const cwd = input.cwd ?? process.cwd()

  if (!bdInstalled()) return { kind: 'allow' }
  if (!existsSync(join(cwd, '.beads'))) return { kind: 'allow' }

  const claimedIssues = runBdJson(['list', '--status', 'in_progress', '--json'], cwd)
  const readyIssues = runBdJson(['ready', '--json'], cwd).slice(0, 3)

  const claimedText =
    claimedIssues.length > 0
      ? `in_progress claim(s):\n${formatIssues(claimedIssues)}`
      : 'in_progress: (none claimed)'

  const readyText =
    readyIssues.length > 0
      ? `top of ready queue:\n${formatIssues(readyIssues)}`
      : 'ready queue: (empty)'

  const text = `bd state:\n${claimedText}\n${readyText}`
  return { kind: 'context', event: 'UserPromptSubmit', text }
}
