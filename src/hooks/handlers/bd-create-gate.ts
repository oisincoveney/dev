/**
 * PreToolUse hook for Bash — validates `bd create` payloads against the
 * ticket rubric stored in `.beads/ticket-rubric.json`.
 *
 * Fail-open on any subprocess error, missing rubric, absent bd/node, or
 * commands that are not `bd create`.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HookDecision, HookHandler } from '../types.js'

// Matches optional leading env vars, then `bd create`, then captures rest.
const BD_CREATE_PATTERN = /(?:^|&&|\|\|)\s*(?:[A-Z_]+=\S+\s+)*bd\s+create\b/

const HEREDOC_OPEN_PATTERN = /<<['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/

interface TicketRubric {
  limits?: {
    epic_body_max_words?: number
    task_body_max_words?: number
  }
}

interface ParsedBody {
  hasFrontmatter?: boolean
  frontmatter?: {
    domain?: string
    artifact?: string
    out_of_scope?: unknown[]
    files?: unknown[]
    verify?: unknown[]
    ac?: unknown[]
    type?: string
    [k: string]: unknown
  }
  body?: string
}

function getGitRoot(cwd: string): string | null {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8',
  })
  if (result.status !== 0 || result.error) return null
  return result.stdout.trim()
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length
}

function extractHeredocBody(command: string, tag: string): string | null {
  const lines = command.split('\n')
  const openPattern = new RegExp(`<<['"]?${tag}['"]?`)
  let capturing = false
  const bodyLines: string[] = []

  for (const line of lines) {
    if (!capturing) {
      if (openPattern.test(line)) {
        capturing = true
      }
    } else {
      if (line.trim() === tag) break
      bodyLines.push(line)
    }
  }

  return capturing ? bodyLines.join('\n') : null
}

function parseBodyWithNode(body: string, dslDir: string): ParsedBody | null {
  const parseScript = join(dslDir, 'parse.mjs')
  if (!existsSync(parseScript)) return null

  const result = spawnSync('node', [parseScript], {
    input: body,
    encoding: 'utf8',
  })
  if (result.status !== 0 || result.error) return null
  try {
    return JSON.parse(result.stdout) as ParsedBody
  } catch {
    return null
  }
}

function extractBodyFromCommand(
  command: string,
  gitRoot: string,
): string | null {
  // --body-file=- means heredoc on stdin (inline in the command text)
  const bodyFileDash = /--body-file=-/.test(command)
  if (bodyFileDash) {
    const match = command.match(HEREDOC_OPEN_PATTERN)
    if (match) {
      return extractHeredocBody(command, match[1])
    }
    return null
  }

  const bodyFileMatch = command.match(/--body-file=(\S+)/)
  if (bodyFileMatch) {
    const filePath = bodyFileMatch[1]
    const resolved = filePath.startsWith('/') ? filePath : join(gitRoot, filePath)
    try {
      return readFileSync(resolved, 'utf8')
    } catch {
      return null
    }
  }

  return null
}

function logBypass(gitRoot: string, command: string): void {
  const logPath = join(gitRoot, '.beads', '.gate-bypass.jsonl')
  const entry = JSON.stringify({ ts: new Date().toISOString(), command })
  try {
    appendFileSync(logPath, entry + '\n', 'utf8')
  } catch {
    // fail-open: if we can't write the log, still allow
  }
}

function validateEpic(
  parsed: ParsedBody,
  rubric: TicketRubric,
): string[] {
  const failures: string[] = []
  const fm = parsed.frontmatter ?? {}

  if (!fm.domain) failures.push('epic.domain is required')
  if (!fm.artifact) failures.push('epic.artifact is required')
  if (!Array.isArray(fm.out_of_scope) || fm.out_of_scope.length === 0) {
    failures.push('epic.out_of_scope must have ≥1 item')
  }

  const maxWords = rubric.limits?.epic_body_max_words
  if (maxWords !== undefined) {
    const wordCount = countWords(parsed.body ?? '')
    if (wordCount > maxWords) {
      failures.push(`body exceeds ${maxWords} words (${wordCount} found)`)
    }
  }

  return failures
}

function validateTask(
  parsed: ParsedBody,
  rubric: TicketRubric,
): string[] {
  const failures: string[] = []
  const fm = parsed.frontmatter ?? {}

  if (!Array.isArray(fm.files) || fm.files.length === 0) {
    failures.push('task.files must have ≥1 item')
  }
  if (!Array.isArray(fm.verify) || fm.verify.length === 0) {
    failures.push('task.verify must have ≥1 item')
  }
  if (!Array.isArray(fm.ac) || fm.ac.length === 0) {
    failures.push('task.ac must have ≥1 item')
  }

  const maxWords = rubric.limits?.task_body_max_words
  if (maxWords !== undefined) {
    const wordCount = countWords(parsed.body ?? '')
    if (wordCount > maxWords) {
      failures.push(`body exceeds ${maxWords} words (${wordCount} found)`)
    }
  }

  return failures
}

export const bdCreateGate: HookHandler = (input): HookDecision => {
  const command = input.tool_input?.command
  if (typeof command !== 'string' || command.length === 0) {
    return { kind: 'allow' }
  }

  if (!BD_CREATE_PATTERN.test(command)) {
    return { kind: 'allow' }
  }

  // Gate bypass
  if (/--gate-bypass/.test(command)) {
    const cwd = input.cwd ?? process.cwd()
    const gitRoot = getGitRoot(cwd) ?? cwd
    logBypass(gitRoot, command)
    return { kind: 'allow' }
  }

  const cwd = input.cwd ?? process.cwd()
  const gitRoot = getGitRoot(cwd)
  if (!gitRoot) return { kind: 'allow' }

  const rubricPath = join(gitRoot, '.beads', 'ticket-rubric.json')
  if (!existsSync(rubricPath)) return { kind: 'allow' }

  let rubric: TicketRubric
  try {
    rubric = JSON.parse(readFileSync(rubricPath, 'utf8')) as TicketRubric
  } catch {
    return { kind: 'allow' }
  }

  // Graph mode without extractable body → allow (can't validate JSON-graph payloads)
  const isGraphMode = /--graph/.test(command)
  const body = extractBodyFromCommand(command, gitRoot)
  if (isGraphMode && body === null) {
    return { kind: 'allow' }
  }

  if (body === null) return { kind: 'allow' }

  const dslDir = join(gitRoot, '.beads', 'dsl')
  const parsed = parseBodyWithNode(body, dslDir)

  if (parsed === null || !parsed.hasFrontmatter) {
    // No DSL frontmatter or parse failed → allow (legacy body format)
    return { kind: 'allow' }
  }

  const type = parsed.frontmatter?.type ?? 'task'
  const failures =
    type === 'epic'
      ? validateEpic(parsed, rubric)
      : validateTask(parsed, rubric)

  if (failures.length === 0) return { kind: 'allow' }

  return {
    kind: 'block',
    reason: [
      '⛔ bd create blocked: ticket rubric violations:',
      ...failures.map((f) => `   • ${f}`),
      '',
      '   Fix the ticket body and retry.',
    ].join('\n'),
  }
}
