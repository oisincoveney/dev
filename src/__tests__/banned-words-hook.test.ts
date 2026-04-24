/**
 * Behavioral tests for templates/hooks/banned-words-guard.sh.
 * Invokes the real shell script with synthesized transcript JSONL + config.
 * Skipped if bash or jq isn't available.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const HOOK = resolve(__dirname, '..', '..', 'templates', 'hooks', 'banned-words-guard.sh')

function hasCmd(name: string): boolean {
  const result = spawnSync('command', ['-v', name], { shell: true, stdio: 'ignore' })
  return result.status === 0
}

const canRun = hasCmd('bash') && hasCmd('jq')

function runHook(cwd: string, transcriptPath: string): { status: number; stderr: string } {
  const input = JSON.stringify({ cwd, transcript_path: transcriptPath })
  const result = spawnSync('bash', [HOOK], { input, encoding: 'utf8' })
  return { status: result.status ?? -1, stderr: result.stderr }
}

function writeTranscript(dir: string, assistantText: string): string {
  const path = join(dir, 'transcript.jsonl')
  const line = JSON.stringify({
    type: 'assistant',
    content: [{ type: 'text', text: assistantText }],
  })
  writeFileSync(path, `${line}\n`)
  return path
}

describe.skipIf(!canRun)('banned-words-guard.sh', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'banned-words-hook-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('exits 0 when .dev.config.json is missing', () => {
    const transcript = writeTranscript(dir, 'honestly this is fine')
    const { status } = runHook(dir, transcript)
    expect(status).toBe(0)
  })

  it('exits 0 when bannedWords is empty or absent', () => {
    writeFileSync(join(dir, '.dev.config.json'), JSON.stringify({ bannedWords: [] }))
    const transcript = writeTranscript(dir, 'honestly this is fine')
    const { status } = runHook(dir, transcript)
    expect(status).toBe(0)
  })

  it('blocks when a banned word appears in the last assistant message', () => {
    writeFileSync(join(dir, '.dev.config.json'), JSON.stringify({ bannedWords: ['honest'] }))
    const transcript = writeTranscript(dir, 'to be honest, I think this works')
    const { status, stderr } = runHook(dir, transcript)
    expect(status).toBe(2)
    expect(stderr).toContain('honest')
  })

  it('matches case-insensitively', () => {
    writeFileSync(join(dir, '.dev.config.json'), JSON.stringify({ bannedWords: ['honest'] }))
    const transcript = writeTranscript(dir, 'HONEST answer: it compiles')
    const { status } = runHook(dir, transcript)
    expect(status).toBe(2)
  })

  it('matches as a whole word, not a substring', () => {
    writeFileSync(join(dir, '.dev.config.json'), JSON.stringify({ bannedWords: ['honest'] }))
    const transcript = writeTranscript(dir, 'dishonesty aside, the build passed')
    const { status } = runHook(dir, transcript)
    expect(status).toBe(0)
  })

  it('blocks multi-word phrases literally', () => {
    writeFileSync(
      join(dir, '.dev.config.json'),
      JSON.stringify({ bannedWords: ['should work'] }),
    )
    const transcript = writeTranscript(dir, 'this should work now')
    const { status, stderr } = runHook(dir, transcript)
    expect(status).toBe(2)
    expect(stderr).toContain('should work')
  })

  it('reports all matching entries, not just the first', () => {
    writeFileSync(
      join(dir, '.dev.config.json'),
      JSON.stringify({ bannedWords: ['honest', 'simply'] }),
    )
    const transcript = writeTranscript(dir, 'honest answer: we can simply run the tests')
    const { status, stderr } = runHook(dir, transcript)
    expect(status).toBe(2)
    expect(stderr).toContain('honest')
    expect(stderr).toContain('simply')
  })
})
