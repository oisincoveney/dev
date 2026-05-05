/**
 * PreToolUse hook for Read|Glob — blocks reads into buried dependency
 * directories to prevent verifying hallucinated APIs via stale node_modules.
 */

import type { HookDecision, HookHandler } from '../types.js'

const BURIED_DIRS = [
  /^node_modules[\\/]/,
  /[\\/]node_modules[\\/]/,
  /^dist[\\/]/,
  /[\\/]dist[\\/]/,
  /^build[\\/]/,
  /[\\/]build[\\/]/,
  /^\.next[\\/]/,
  /[\\/]\.next[\\/]/,
  /^target[\\/]/,
  /[\\/]target[\\/]/,
  /^generated[\\/]/,
  /[\\/]generated[\\/]/,
  /^out[\\/]/,
  /[\\/]out[\\/]/,
]

export const docsFirst: HookHandler = (input): HookDecision => {
  if (process.env['ALLOW_DEPS_READ']) return { kind: 'allow' }

  const filePath =
    (input.tool_input?.file_path as string | undefined) ??
    (input.tool_input?.path as string | undefined) ??
    (input.tool_input?.pattern as string | undefined)

  if (typeof filePath !== 'string' || filePath.length === 0) return { kind: 'allow' }

  const isBuried = BURIED_DIRS.some((p) => p.test(filePath))
  if (!isBuried) return { kind: 'allow' }

  return {
    kind: 'block',
    reason: [
      '⛔ Read into a buried dependency directory blocked.',
      '',
      `   Path: ${filePath}`,
      '',
      '   Use WebFetch on official docs first — they are the authoritative',
      '   source. Buried dependency files are stale relative to upstream.',
      '',
      '   If pinned local behavior is what matters, set ALLOW_DEPS_READ=1',
      '   in your env for this turn and explain why in your response.',
    ].join('\n'),
  }
}
