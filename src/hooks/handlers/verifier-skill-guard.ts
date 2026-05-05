/**
 * Stop hook — proof of skill-driven verification. When Claude claims completion
 * or runs `bd close` after editing files, requires spec-verifier or direct
 * review skill invocations.
 */

import { readFileSync } from 'node:fs'
import type { HookDecision, HookHandler } from '../types.js'

const COMPLETION_PATTERN =
  /(this (is |now |all )?(done|works?|working|complete|finished|ready))|(should work( now)?\.?$)|(all tests? (pass(es)?|are (green|passing)))|(task (is |now )?complete)|(implementation (is |now )?complete)|(everything (is |now )?working)|(the (changes?|fix|refactor) (is |are |now )?(done|complete|working))/i

interface TranscriptEntry {
  type?: string
  role?: string
  name?: string
  content?: unknown
  input?: { command?: string; file_path?: string; skill?: string; prompt?: string }
  message?: { content?: unknown }
}

function parseTranscript(path: string): TranscriptEntry[] {
  try {
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as TranscriptEntry)
  } catch {
    return []
  }
}

function getContentBlocks(entry: TranscriptEntry): TranscriptEntry[] {
  const content = entry.content ?? entry.message?.content
  if (Array.isArray(content)) return content as TranscriptEntry[]
  return []
}

function extractAssistantText(entries: TranscriptEntry[]): string {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    if (e.type !== 'assistant' && e.role !== 'assistant') continue
    const blocks = getContentBlocks(e)
    const texts = blocks.filter((b) => b.type === 'text').map((b) => (b as { text?: string }).text ?? '')
    if (texts.length > 0) return texts.join(' ')
    if (typeof e.content === 'string') return e.content
    if (typeof e.message?.content === 'string') return e.message.content
  }
  return ''
}

function getToolUses(entries: TranscriptEntry[], toolName: string): TranscriptEntry[] {
  const uses: TranscriptEntry[] = []
  for (const e of entries) {
    if (e.type === 'tool_use' && e.name === toolName) {
      uses.push(e)
    }
    for (const block of getContentBlocks(e)) {
      if (block.type === 'tool_use' && block.name === toolName) uses.push(block)
    }
    const msgBlocks = Array.isArray(e.message?.content) ? (e.message.content as TranscriptEntry[]) : []
    for (const block of msgBlocks) {
      if (block.type === 'tool_use' && block.name === toolName) uses.push(block)
    }
  }
  return uses
}

export const verifierSkillGuard: HookHandler = (input): HookDecision => {
  const transcriptPath = input.transcript_path
  if (!transcriptPath) return { kind: 'allow' }

  const entries = parseTranscript(transcriptPath)
  if (entries.length === 0) return { kind: 'allow' }

  const lastMsg = extractAssistantText(entries)

  const claimsDone = COMPLETION_PATTERN.test(lastMsg)
  const bashUses = getToolUses(entries, 'Bash')
  const bdClosedRan = bashUses.some((u) => /\bbd\s+close\b/.test(u.input?.command ?? ''))

  if (!claimsDone && !bdClosedRan) return { kind: 'allow' }

  // Check edited files
  const editUses = [...getToolUses(entries, 'Edit'), ...getToolUses(entries, 'Write')]
  const editedFiles = editUses
    .map((u) => u.input?.file_path ?? '')
    .filter(Boolean)

  if (editedFiles.length === 0) return { kind: 'allow' }

  // Determine required language skills
  const requiredSkills = new Set<string>(['code-review'])
  if (editedFiles.some((f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f))) {
    requiredSkills.add('typescript-advanced-types')
  }
  if (editedFiles.some((f) => f.endsWith('.go'))) {
    requiredSkills.add('golang-code-style')
    requiredSkills.add('golang-error-handling')
  }
  if (editedFiles.some((f) => /\/app\/|\/pages\//.test(f) && /\.(tsx?|jsx?)$/.test(f))) {
    requiredSkills.add('nextjs-app-router-patterns')
  }

  // Check Skill invocations in transcript
  const skillUses = getToolUses(entries, 'Skill')
  const invokedSkills = new Set(skillUses.map((u) => (u.input as { skill?: string })?.skill ?? ''))

  // Verifier subagent path
  if (invokedSkills.has('spec-verifier')) return { kind: 'allow' }
  const agentUses = getToolUses(entries, 'Agent')
  const verifierAgent = agentUses.some((u) =>
    /spec-verifier|verifier-loop/i.test(u.input?.prompt ?? ''),
  )
  if (verifierAgent) return { kind: 'allow' }

  // Direct skill path
  const missing = [...requiredSkills].filter((s) => !invokedSkills.has(s))
  if (missing.length === 0) return { kind: 'allow' }

  return {
    kind: 'block',
    reason: [
      '⛔ Verification skill(s) not invoked.',
      '',
      '   You claimed completion (or ran \'bd close\') after editing files,',
      '   but didn\'t apply review skills. Either:',
      '',
      '   • Invoke the \'spec-verifier\' skill, OR spawn an Agent whose',
      '     prompt references spec-verifier / verifier-loop, OR',
      '   • Invoke each of these skills directly via the Skill tool:',
      '',
      ...missing.map((s) => `       - ${s}`),
      '',
    ].join('\n'),
  }
}
