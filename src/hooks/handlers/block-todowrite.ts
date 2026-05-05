/**
 * PreToolUse hook for TodoWrite — blocks it and redirects to beads.
 *
 * TodoWrite is not the task tracker for this project; beads (bd) is.
 * This hook fires unconditionally whenever the model tries to call TodoWrite.
 *
 * Migrated from templates/hooks/block-todowrite.sh.
 */

import type { HookHandler } from '../types.js'

const BLOCK_REASON = `\
⛔ TodoWrite is blocked. Use beads instead:
   bd create <title>     — create an issue
   bd update <id>        — update an issue
   bd ready              — find available work
   bd show <id>          — view issue details
   bd close <id>         — complete work
Run 'bd prime' for the full workflow reference.`

export const blockTodowrite: HookHandler = (_input) => ({
  kind: 'block',
  reason: BLOCK_REASON,
})
