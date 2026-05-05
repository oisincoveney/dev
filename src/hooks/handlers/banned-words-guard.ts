/**
 * Stop hook — blocks responses that contain banned words/phrases from
 * `.dev.config.json bannedWords[]`.
 *
 * Phrases (entries containing spaces) are matched as literal substrings.
 * Single words are matched with word boundaries (\b).
 * All matching is case-insensitive.
 *
 * Migrated from templates/hooks/banned-words-guard.sh.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HookHandler } from '../types.js'

interface DevConfig {
  bannedWords?: string[]
}

interface TranscriptLine {
  type?: string
  role?: string
  content?: unknown
  message?: {
    content?: unknown
  }
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T
  } catch {
    return null
  }
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (Array.isArray(content)) {
    return content
      .filter((block): block is { type: string; text: string } =>
        typeof block === 'object' &&
        block !== null &&
        (block as Record<string, unknown>)['type'] === 'text' &&
        typeof (block as Record<string, unknown>)['text'] === 'string',
      )
      .map((block) => block.text)
      .join(' ')
  }
  return ''
}

function extractAssistantText(line: TranscriptLine): string {
  const isAssistant = line.type === 'assistant' || line.role === 'assistant'
  if (!isAssistant) return ''

  if (line.content !== undefined) {
    return extractTextFromContent(line.content)
  }

  if (line.message?.content !== undefined) {
    return extractTextFromContent(line.message.content)
  }

  return ''
}

function parseTranscript(transcriptPath: string): string {
  let rawContent: string
  try {
    rawContent = readFileSync(transcriptPath, 'utf8')
  } catch {
    return ''
  }

  const lines = rawContent.split('\n').filter((line) => line.trim().length > 0)
  let lastAssistantText = ''

  for (const line of lines) {
    let parsed: TranscriptLine
    try {
      parsed = JSON.parse(line) as TranscriptLine
    } catch {
      continue
    }

    const text = extractAssistantText(parsed)
    if (text.length > 0) {
      lastAssistantText = text
    }
  }

  return lastAssistantText
}

function buildWordBoundaryPattern(word: string): RegExp {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${escaped}\\b`, 'i')
}

function findBannedHits(message: string, bannedWords: string[]): string[] {
  const hits: string[] = []

  for (const entry of bannedWords) {
    if (entry.length === 0) continue

    const isPhrase = entry.includes(' ')
    if (isPhrase) {
      if (message.toLowerCase().includes(entry.toLowerCase())) {
        hits.push(entry)
      }
    } else {
      const pattern = buildWordBoundaryPattern(entry)
      if (pattern.test(message)) {
        hits.push(entry)
      }
    }
  }

  return hits
}

export const bannedWordsGuard: HookHandler = async (input) => {
  const transcriptPath = input.transcript_path
  const cwd = input.cwd ?? process.cwd()

  if (!transcriptPath) {
    return { kind: 'allow' }
  }

  const configPath = join(cwd, '.dev.config.json')
  const config = readJsonFile<DevConfig>(configPath)
  if (!config?.bannedWords || config.bannedWords.length === 0) {
    return { kind: 'allow' }
  }

  const lastMessage = parseTranscript(transcriptPath)
  if (lastMessage.length === 0) {
    return { kind: 'allow' }
  }

  const hits = findBannedHits(lastMessage, config.bannedWords)
  if (hits.length === 0) {
    return { kind: 'allow' }
  }

  const hitList = hits.map((h) => `  - "${h}"`).join('\n')
  return {
    kind: 'block',
    reason: `⛔ Response contains banned words/phrases:\n${hitList}\n\n   Rewrite without these terms.`,
  }
}
