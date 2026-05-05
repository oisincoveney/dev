/**
 * Stop hook — blocks responses that cite external docs without a
 * WebFetch or WebSearch tool call in the transcript.
 *
 * Skips the check if the cited library is in the project's package.json,
 * since in-tree knowledge doesn't require external lookup.
 *
 * Migrated from templates/hooks/citation-check.sh.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HookHandler } from '../types.js'
import { readLastAssistantMessage } from './pre-stop-verification.js'

interface PackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
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
}

const CITATION_PATTERNS: RegExp[] = [
  /according to/i,
  /per the docs/i,
  /the docs (say|state)/i,
  /the spec (says|states)/i,
  /the (RFC|standard) (says|states)/i,
]

const WEB_TOOL_NAMES = new Set(['WebFetch', 'WebSearch', 'context7'])

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T
  } catch {
    return null
  }
}

function hasCitationPattern(text: string): boolean {
  return CITATION_PATTERNS.some((pattern) => pattern.test(text))
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

function webToolWasUsed(transcriptPath: string): boolean {
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
      if (block.name && WEB_TOOL_NAMES.has(block.name)) return true
    }
  }

  return false
}

function citedDepInPackageJson(lastMessage: string, pkgJsonPath: string): boolean {
  const pkg = readJson<PackageJson>(pkgJsonPath)
  if (!pkg) return false

  const allDeps = Object.keys({
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  })

  return allDeps.some((dep) => lastMessage.includes(dep))
}

export const citationCheck: HookHandler = (input) => {
  const transcriptPath = input.transcript_path
  if (!transcriptPath || !existsSync(transcriptPath)) {
    return { kind: 'allow' }
  }

  try {
    const lastMessage = readLastAssistantMessage(transcriptPath)
    if (!hasCitationPattern(lastMessage)) return { kind: 'allow' }

    if (webToolWasUsed(transcriptPath)) return { kind: 'allow' }

    const cwd = input.cwd ?? process.cwd()
    const pkgJsonPath = join(cwd, 'package.json')
    if (existsSync(pkgJsonPath) && citedDepInPackageJson(lastMessage, pkgJsonPath)) {
      return { kind: 'allow' }
    }

    return {
      kind: 'block',
      reason: [
        '⛔ Response cites external documentation without a WebFetch or WebSearch call.',
        '   Verify claims via WebFetch/WebSearch before asserting doc content.',
      ].join('\n'),
    }
  } catch {
    return { kind: 'allow' }
  }
}
