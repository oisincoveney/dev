/**
 * PreToolUse hook for Write|Edit — when inside a parallel-tickets worktree,
 * blocks any absolute-path write that escapes the worktree root.
 */

import type { HookDecision, HookHandler } from '../types.js'

const WORKTREE_PATTERN = /\/.claude\/worktrees\/([^/]+)/

export const worktreeWriteGuard: HookHandler = (input): HookDecision => {
  const filePath = input.tool_input?.file_path ?? input.tool_input?.filePath
  if (typeof filePath !== 'string' || filePath.length === 0) return { kind: 'allow' }

  const cwd = input.cwd ?? process.cwd()

  // Only enforce inside a worktree
  const worktreeMatch = WORKTREE_PATTERN.exec(cwd)
  if (!worktreeMatch) return { kind: 'allow' }

  // Relative paths are always safe (interpreted against cwd which is inside the worktree)
  if (!filePath.startsWith('/')) return { kind: 'allow' }

  const worktreeRoot = cwd.replace(/(\/\.claude\/worktrees\/[^/]+).*/, '$1')
  if (!WORKTREE_PATTERN.test(worktreeRoot)) return { kind: 'allow' }

  if (filePath.startsWith(worktreeRoot + '/') || filePath === worktreeRoot) {
    return { kind: 'allow' }
  }

  return {
    kind: 'block',
    reason: [
      '⛔ Worktree write escape blocked.',
      '',
      `   Worker is running in: ${worktreeRoot}`,
      `   Tried to write to:    ${filePath}`,
      '',
      '   Absolute paths from a parallel-tickets worker MUST stay under',
      '   the worktree root. Use a relative path, or rebuild the absolute',
      '   path against $WORKTREE_ROOT.',
      '',
    ].join('\n'),
  }
}
