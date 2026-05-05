/**
 * PreToolUse hook for Bash — blocks destructive commands.
 *
 * Heredoc bodies are excluded from pattern scanning. The `--no-verify`
 * rewrite case cannot be represented as an `allowWithUpdate` in the current
 * HookDecision type, so it blocks with a helpful message instead.
 *
 * Migrated from templates/hooks/destructive-command-guard.sh.
 */

import type { HookHandler } from '../types.js'

// Patterns that are unconditionally blocked.
const BLOCKED_PATTERNS: RegExp[] = [
  /git\s+reset\s+--hard/,
  /git\s+push\s+(--force|-f)(\s|$)/,
  /git\s+clean\s+.*-[a-z]*f/,
  /git\s+checkout\s+(--|\.)/,
  /git\s+restore\s+(--staged\s+)?(\.|--)/,
  /git\s+branch\s+-D/,
  /rm\s+.*-[a-z]*r[a-z]*f|rm\s+.*-[a-z]*f[a-z]*r/,
  /DROP\s+(TABLE|DATABASE|SCHEMA)/i,
  /(npm|yarn|bun|pnpm)\s+publish(\s|$)/,
]

const NO_VERIFY_PATTERN = /git\s+(commit|push)\s+.*--no-verify/

const HEREDOC_OPEN = /<<['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/

/**
 * Strip heredoc bodies so their content is not scanned as executable code.
 * Lines between `<<TAG` and the closing `TAG` line are removed.
 */
function stripHeredocs(command: string): string {
  const lines = command.split('\n')
  const result: string[] = []
  let insideHeredoc = false
  let closingTag = ''

  for (const line of lines) {
    if (!insideHeredoc) {
      const match = line.match(HEREDOC_OPEN)
      if (match) {
        closingTag = match[1]
        insideHeredoc = true
      }
      result.push(line)
    } else {
      const trimmed = line.trim()
      if (trimmed === closingTag) {
        insideHeredoc = false
        closingTag = ''
        result.push(line)
      }
      // Lines inside the heredoc body are dropped from scanning
    }
  }

  return result.join('\n')
}

export const destructiveCommandGuard: HookHandler = (input) => {
  const command = input.tool_input?.command
  if (typeof command !== 'string' || command.length === 0) {
    return { kind: 'allow' }
  }

  const scanTarget = stripHeredocs(command)

  if (NO_VERIFY_PATTERN.test(scanTarget)) {
    return {
      kind: 'block',
      reason:
        '⛔ --no-verify is not allowed. Remove --no-verify from the command and retry.',
    }
  }

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(scanTarget)) {
      return {
        kind: 'block',
        reason: `⛔ Destructive command blocked: matches pattern ${pattern.toString()}.\n   Get explicit user approval before running destructive operations.`,
      }
    }
  }

  return { kind: 'allow' }
}
