/**
 * PreToolUse hook on all tools — appends one JSON line per tool call to
 * .claude/audit.jsonl. Always allows. Failures are silently ignored.
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { HookDecision, HookHandler } from '../types.js'

export const auditLog: HookHandler = (input): HookDecision => {
  try {
    const cwd = input.cwd ?? process.cwd()
    const logDir = join(cwd, '.claude')
    const logFile = join(logDir, 'audit.jsonl')

    mkdirSync(logDir, { recursive: true })

    const line = JSON.stringify({
      ts: Date.now() / 1000,
      sessionId: input.session_id ?? null,
      tool: input.tool_name ?? null,
      input: input.tool_input ?? null,
    })
    appendFileSync(logFile, line + '\n', 'utf8')
  } catch {
    // Never block on audit failures
  }
  return { kind: 'allow' }
}
