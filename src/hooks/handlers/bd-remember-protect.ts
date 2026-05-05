/**
 * PreToolUse hook for Bash — protects plan-approved: and plan-rejected:
 * bd-remember namespaces from direct agent writes.
 *
 * Those namespaces are reserved for the /approve, /reject, and /regrill
 * slash commands and must not be written to by the agent directly.
 */

import type { HookDecision, HookHandler } from '../types.js'

// Matches `bd remember` or `bd memories` targeting the protected namespaces.
const PROTECTED_WRITE_PATTERN =
  /bd\s+(remember|memories)\s+.*plan-(approved|rejected):/

// `bd memories <key>` with no additional write args is a read-only lookup.
const READ_ONLY_PATTERN = /bd\s+memories\s+/

// Env-var marker injected by the trusted slash commands.
const TRUSTED_CALLER_PATTERN =
  /OISIN_DEV_PLAN_(APPROVE|REJECT|REGRILL)=1\s+bd\s+remember/

const BLOCK_REASON = `\
⛔ bd remember blocked: plan-approved: and plan-rejected: namespaces are reserved.

These keys are written exclusively by the /approve, /reject, and /regrill
slash commands — not by the agent directly.

To approve or reject a plan, ask the user to run the appropriate slash command.`

export const bdRememberProtect: HookHandler = (input): HookDecision => {
  const command = input.tool_input?.command
  if (typeof command !== 'string' || command.length === 0) {
    return { kind: 'allow' }
  }

  if (!PROTECTED_WRITE_PATTERN.test(command)) {
    return { kind: 'allow' }
  }

  // Read-only lookup (`bd memories <key>`) is safe even for protected namespaces.
  if (READ_ONLY_PATTERN.test(command) && !/bd\s+remember\s+/.test(command)) {
    return { kind: 'allow' }
  }

  // Trusted slash commands carry an env-var marker.
  if (TRUSTED_CALLER_PATTERN.test(command)) {
    return { kind: 'allow' }
  }

  return { kind: 'block', reason: BLOCK_REASON }
}
