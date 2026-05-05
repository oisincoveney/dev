/**
 * Stop hook — proof-of-work gate.
 *
 * If the last assistant message claims completion but the test command
 * was NOT run this session, the response is blocked.
 *
 * Migrated from templates/hooks/pre-stop-verification.sh.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HookHandler } from '../types.js'

interface DevConfig {
  commands?: {
    test?: string
  }
}

interface TranscriptLine {
  type?: string
  role?: string
  content?: unknown
  message?: { content?: unknown }
}

interface ToolUseBlock {
  type: string
  name?: string
  input?: { command?: string }
}

const COMPLETION_PATTERNS: RegExp[] = [
  /this\s+(is|now|all)?\s*(done|works?|working|complete|finished|ready)/i,
  /should work(\s+now)?\.?\s*$/i,
  /all\s+tests?\s+(pass(es)?|are\s+(green|passing))/i,
  /task\s+(is|now)?\s*complete/i,
  /implementation\s+(is|now)?\s*complete/i,
  /everything\s+(is|now)?\s*working/i,
  /the\s+(changes?|fix|refactor)\s+(is|are|now)?\s*(done|complete|working)/i,
]

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T
  } catch {
    return null
  }
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter(
      (block): block is { type: string; text: string } =>
        typeof block === 'object' &&
        block !== null &&
        (block as Record<string, unknown>)['type'] === 'text' &&
        typeof (block as Record<string, unknown>)['text'] === 'string',
    )
    .map((block) => block.text)
    .join(' ')
}

export function readLastAssistantMessage(transcriptPath: string): string {
  let raw: string
  try {
    raw = readFileSync(transcriptPath, 'utf8')
  } catch {
    return ''
  }

  const lines = raw.split('\n').filter((l) => l.trim().length > 0)
  let lastText = ''

  for (const line of lines) {
    let parsed: TranscriptLine
    try {
      parsed = JSON.parse(line) as TranscriptLine
    } catch {
      continue
    }

    const isAssistant = parsed.type === 'assistant' || parsed.role === 'assistant'
    if (!isAssistant) continue

    const content = parsed.content ?? parsed.message?.content
    const text = extractTextFromContent(content)
    if (text.length > 0) lastText = text
  }

  return lastText
}

function isCompletionClaim(text: string): boolean {
  return COMPLETION_PATTERNS.some((pattern) => pattern.test(text))
}

function extractToolUseBlocks(content: unknown): ToolUseBlock[] {
  if (!Array.isArray(content)) return []
  return content.filter(
    (block): block is ToolUseBlock =>
      typeof block === 'object' &&
      block !== null &&
      (block as Record<string, unknown>)['type'] === 'tool_use',
  )
}

function testCommandWasRun(transcriptPath: string, testCommand: string): boolean {
  let raw: string
  try {
    raw = readFileSync(transcriptPath, 'utf8')
  } catch {
    return false
  }

  const lines = raw.split('\n').filter((l) => l.trim().length > 0)

  for (const line of lines) {
    let parsed: TranscriptLine
    try {
      parsed = JSON.parse(line) as TranscriptLine
    } catch {
      continue
    }

    const isAssistant = parsed.type === 'assistant' || parsed.role === 'assistant'
    if (!isAssistant) continue

    const content = parsed.content ?? parsed.message?.content
    const toolBlocks = extractToolUseBlocks(content)

    for (const block of toolBlocks) {
      if (block.name === 'Bash' && typeof block.input?.command === 'string') {
        if (block.input.command.includes(testCommand)) return true
      }
    }
  }

  return false
}

export const preStopVerification: HookHandler = (input) => {
  const transcriptPath = input.transcript_path
  if (!transcriptPath || !existsSync(transcriptPath)) {
    return { kind: 'allow' }
  }

  const cwd = input.cwd ?? process.cwd()
  const configPath = join(cwd, '.dev.config.json')
  const config = readJson<DevConfig>(configPath)
  const testCommand = config?.commands?.test
  if (!testCommand) return { kind: 'allow' }

  const lastMessage = readLastAssistantMessage(transcriptPath)
  if (!isCompletionClaim(lastMessage)) return { kind: 'allow' }

  if (testCommandWasRun(transcriptPath, testCommand)) return { kind: 'allow' }

  return {
    kind: 'block',
    reason: [
      '⛔ Completion claim detected but test command was not run this session.',
      `   Test command: ${testCommand}`,
      '   Run it, observe the output, and include the result in your response.',
    ].join('\n'),
  }
}
