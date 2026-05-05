/**
 * UserPromptSubmit hook — emits per-turn state (git branch + top ready bd issue).
 *
 * Injects a short `<turn-context>` line so the model always knows which
 * branch is checked out and what the top ready beads issue is. Silent
 * no-op when not inside a git repo.
 *
 * Migrated from templates/hooks/context-injector.sh.
 */

import { spawnSync } from 'node:child_process'
import type { HookDecision, HookHandler, HookInput } from '../types.js'

function currentBranch(cwd: string): string {
  const result = spawnSync('git', ['branch', '--show-current'], {
    cwd,
    encoding: 'utf8',
  })
  if (result.status !== 0 || result.error) return ''
  return result.stdout.trim()
}

function topReadyIssue(cwd: string): string {
  const result = spawnSync('bd', ['ready'], {
    cwd,
    encoding: 'utf8',
  })
  if (result.status !== 0 || result.error) return ''
  const firstLine = result.stdout.split('\n')[0]?.trim() ?? ''
  if (firstLine.includes('no ready')) return ''
  return firstLine
}

function bdAvailable(cwd: string): boolean {
  const result = spawnSync('command', ['-v', 'bd'], {
    cwd,
    encoding: 'utf8',
    shell: true,
  })
  return result.status === 0 && !result.error
}

export const contextInjector: HookHandler = (input): HookDecision => {
  const cwd = input.cwd ?? process.cwd()

  const branch = currentBranch(cwd)
  if (branch.length === 0) {
    return { kind: 'allow' }
  }

  let line = `Branch: ${branch}`

  if (bdAvailable(cwd)) {
    const top = topReadyIssue(cwd)
    if (top.length > 0) {
      line = `${line} | Top ready: ${top}`
    }
  }

  const text = `<turn-context>${line}</turn-context>`
  return { kind: 'context', event: 'UserPromptSubmit', text }
}
