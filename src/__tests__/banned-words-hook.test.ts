import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bannedWordsGuard } from '../hooks/handlers/banned-words-guard.js'
import type { HookInput } from '../hooks/types.js'

function writeTranscript(dir: string, assistantText: string): string {
  const path = join(dir, 'transcript.jsonl')
  const line = JSON.stringify({
    type: 'assistant',
    content: [{ type: 'text', text: assistantText }],
  })
  writeFileSync(path, `${line}\n`)
  return path
}

async function runHook(cwd: string, transcriptPath: string) {
  return bannedWordsGuard({ cwd, transcript_path: transcriptPath } as HookInput)
}

describe('banned-words-guard', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'banned-words-hook-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('allows when .dev.config.json is missing', async () => {
    const transcript = writeTranscript(dir, 'honestly this is fine')
    const r = await runHook(dir, transcript)
    expect(r.kind).toBe('allow')
  })

  it('allows when bannedWords is empty or absent', async () => {
    writeFileSync(join(dir, '.dev.config.json'), JSON.stringify({ bannedWords: [] }))
    const transcript = writeTranscript(dir, 'honestly this is fine')
    const r = await runHook(dir, transcript)
    expect(r.kind).toBe('allow')
  })

  it('blocks when a banned word appears in the last assistant message', async () => {
    writeFileSync(join(dir, '.dev.config.json'), JSON.stringify({ bannedWords: ['honest'] }))
    const transcript = writeTranscript(dir, 'to be honest, I think this works')
    const r = await runHook(dir, transcript)
    expect(r.kind).toBe('block')
    expect((r as { reason: string }).reason).toContain('honest')
  })

  it('matches case-insensitively', async () => {
    writeFileSync(join(dir, '.dev.config.json'), JSON.stringify({ bannedWords: ['honest'] }))
    const transcript = writeTranscript(dir, 'HONEST answer: it compiles')
    const r = await runHook(dir, transcript)
    expect(r.kind).toBe('block')
  })

  it('matches as a whole word, not a substring', async () => {
    writeFileSync(join(dir, '.dev.config.json'), JSON.stringify({ bannedWords: ['honest'] }))
    const transcript = writeTranscript(dir, 'dishonesty aside, the build passed')
    const r = await runHook(dir, transcript)
    expect(r.kind).toBe('allow')
  })

  it('blocks multi-word phrases literally', async () => {
    writeFileSync(join(dir, '.dev.config.json'), JSON.stringify({ bannedWords: ['should work'] }))
    const transcript = writeTranscript(dir, 'this should work now')
    const r = await runHook(dir, transcript)
    expect(r.kind).toBe('block')
    expect((r as { reason: string }).reason).toContain('should work')
  })

  it('reports all matching entries, not just the first', async () => {
    writeFileSync(join(dir, '.dev.config.json'), JSON.stringify({ bannedWords: ['honest', 'simply'] }))
    const transcript = writeTranscript(dir, 'honest answer: we can simply run the tests')
    const r = await runHook(dir, transcript)
    expect(r.kind).toBe('block')
    expect((r as { reason: string }).reason).toContain('honest')
    expect((r as { reason: string }).reason).toContain('simply')
  })
})
