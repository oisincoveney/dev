/**
 * Stop hook — inside a parallel-tickets worker, blocks stop if the worker
 * hasn't completed its lifecycle (uncommitted changes, unpushed commits,
 * or a bd ticket still in_progress).
 */

import { spawnSync } from 'node:child_process'
import type { HookDecision, HookHandler } from '../types.js'

const WORKTREE_PATTERN = /\/.claude\/worktrees\/([^/]+)/

function git(args: string[], cwd: string): string {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
  return r.status === 0 ? (r.stdout ?? '') : ''
}

export const worktreeStopGuard: HookHandler = (input): HookDecision => {
  const cwd = input.cwd ?? process.cwd()

  if (!WORKTREE_PATTERN.test(cwd)) return { kind: 'allow' }

  const worktreeRoot = cwd.replace(/(\/\.claude\/worktrees\/[^/]+).*/, '$1')
  if (!WORKTREE_PATTERN.test(worktreeRoot)) return { kind: 'allow' }

  if (!git(['rev-parse', '--git-dir'], worktreeRoot)) return { kind: 'allow' }

  const reasons: string[] = []

  // Uncommitted changes?
  const status = git(['status', '--porcelain'], worktreeRoot)
  if (status.trim()) reasons.push(`uncommitted changes in ${worktreeRoot}`)

  // Unpushed commits?
  const upstream = git(['rev-parse', '--abbrev-ref', '@{u}'], worktreeRoot)
  if (upstream.trim()) {
    const unpushed = git(['log', '@{u}..HEAD', '--oneline'], worktreeRoot)
    if (unpushed.trim()) {
      const branch = git(['branch', '--show-current'], worktreeRoot).trim() || 'HEAD'
      reasons.push(`unpushed commits on ${branch}`)
    }
  } else {
    const headSha = git(['rev-parse', 'HEAD'], worktreeRoot).trim()
    const remoteHead = git(['rev-parse', 'origin/HEAD'], worktreeRoot).trim()
    if (headSha && remoteHead && headSha !== remoteHead) {
      reasons.push('branch has commits but no upstream — run: git push -u origin HEAD')
    }
  }

  // In-progress bd tickets?
  const bdCheck = spawnSync('which', ['bd'], { encoding: 'utf8' })
  if (bdCheck.status === 0) {
    const bdResult = spawnSync('bd', ['list', '--status', 'in_progress', '--json'], {
      cwd: worktreeRoot,
      encoding: 'utf8',
    })
    if (bdResult.status === 0 && bdResult.stdout) {
      try {
        const items = JSON.parse(bdResult.stdout) as Array<{ id?: string }>
        for (const item of items) {
          if (item.id) reasons.push(`bd ticket ${item.id} still in_progress — close it or report FAIL`)
        }
      } catch {
        // ignore parse errors
      }
    }
  }

  if (reasons.length === 0) return { kind: 'allow' }

  return {
    kind: 'block',
    reason: [
      '⛔ Parallel-tickets worker stop blocked.',
      '',
      `   Worktree: ${worktreeRoot}`,
      '',
      '   You have not finished the worker lifecycle. Outstanding:',
      ...reasons.map((r) => `     - ${r}`),
      '',
      '   Steps 6-10 of the worker prompt MUST run before you stop:',
      '     6. spec-verifier (already done if you got here)',
      '     7. branch on result (PASS → bd close; FAIL → report)',
      '     8. git commit',
      '     9. git push -u origin HEAD',
      '    10. return one-line status to caller',
      '',
      '   The verifier\'s "## Result:" markdown is NOT your return value.',
      '',
    ].join('\n'),
  }
}
