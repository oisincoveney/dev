/**
 * PreToolUse hook for Bash — blocks `git commit` commands containing
 * Co-Authored-By trailers. Authorship attribution to AI agents is opt-in
 * per repo, and this project's policy is opt-out.
 *
 * Migrated from templates/hooks/block-coauthor.sh in 0t6.
 */

import type { HookHandler } from '../types.js'

const COMMIT_PATTERN = /^git\s+commit/
const COAUTHOR_PATTERN = /co-authored-by:/i

export const blockCoauthor: HookHandler = (input) => {
  const command = input.tool_input?.command
  if (typeof command !== 'string' || command.length === 0) {
    return { kind: 'allow' }
  }
  if (!COMMIT_PATTERN.test(command)) {
    return { kind: 'allow' }
  }
  if (COAUTHOR_PATTERN.test(command)) {
    return {
      kind: 'block',
      reason:
        '⛔ Co-Authored-By trailers are not allowed in this project.\n   Rewrite the commit message without the Co-Authored-By line.',
    }
  }
  return { kind: 'allow' }
}
