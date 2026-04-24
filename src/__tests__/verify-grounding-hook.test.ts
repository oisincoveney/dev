/**
 * Behavioral tests for templates/hooks/verify-grounding.sh.
 * Synthesises transcript JSONL representing various turn states and invokes
 * the real shell script. Skipped if bash or jq isn't available.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const HOOK = resolve(__dirname, '..', '..', 'templates', 'hooks', 'verify-grounding.sh')

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

type Entry =
  | { type: 'user'; text: string }
  | { type: 'assistant-text'; text: string }
  | { type: 'assistant-tool'; name: string }

function writeTranscript(dir: string, entries: Entry[]): string {
  const path = join(dir, 'transcript.jsonl')
  const lines = entries.map((entry) => {
    if (entry.type === 'user') {
      return JSON.stringify({ type: 'user', content: [{ type: 'text', text: entry.text }] })
    }
    if (entry.type === 'assistant-text') {
      return JSON.stringify({
        type: 'assistant',
        content: [{ type: 'text', text: entry.text }],
      })
    }
    return JSON.stringify({
      type: 'assistant',
      content: [{ type: 'tool_use', name: entry.name, input: {} }],
    })
  })
  writeFileSync(path, `${lines.join('\n')}\n`)
  return path
}

describe.skipIf(!canRun)('verify-grounding.sh', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'verify-grounding-hook-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('exits 0 when no transcript is provided', () => {
    const result = spawnSync('bash', [HOOK], {
      input: JSON.stringify({ cwd: dir }),
      encoding: 'utf8',
    })
    expect(result.status).toBe(0)
  })

  it('blocks with GATE when the turn has no grounding tool calls', () => {
    const transcript = writeTranscript(dir, [
      { type: 'user', text: 'how does X work?' },
      { type: 'assistant-text', text: 'it works like this' },
    ])
    const { status, stderr } = runHook(dir, transcript)
    expect(status).toBe(2)
    expect(stderr).toContain('without doing any research')
    expect(stderr).toContain('VERIFY_GROUNDING_GATE_FIRED')
  })

  it('blocks with AUDIT when the turn has a Read tool call', () => {
    const transcript = writeTranscript(dir, [
      { type: 'user', text: 'what does foo do?' },
      { type: 'assistant-tool', name: 'Read' },
      { type: 'assistant-text', text: 'foo does X' },
    ])
    const { status, stderr } = runHook(dir, transcript)
    expect(status).toBe(2)
    expect(stderr).toContain('Audit every factual claim')
    expect(stderr).toContain('VERIFY_GROUNDING_AUDIT_FIRED')
  })

  it('treats WebFetch as a grounding tool call', () => {
    const transcript = writeTranscript(dir, [
      { type: 'user', text: 'how does lib X work?' },
      { type: 'assistant-tool', name: 'WebFetch' },
      { type: 'assistant-text', text: 'lib X does Y' },
    ])
    const { status, stderr } = runHook(dir, transcript)
    expect(status).toBe(2)
    expect(stderr).toContain('VERIFY_GROUNDING_AUDIT_FIRED')
  })

  it('does not count Write/Edit/TodoWrite as grounding', () => {
    const transcript = writeTranscript(dir, [
      { type: 'user', text: 'change this' },
      { type: 'assistant-tool', name: 'Edit' },
      { type: 'assistant-tool', name: 'Write' },
      { type: 'assistant-text', text: 'done' },
    ])
    const { status, stderr } = runHook(dir, transcript)
    expect(status).toBe(2)
    expect(stderr).toContain('VERIFY_GROUNDING_GATE_FIRED')
  })

  it('resets grounding count at each user turn', () => {
    // Previous turn had a Read, but current turn starts fresh with no tools.
    const transcript = writeTranscript(dir, [
      { type: 'user', text: 'first question' },
      { type: 'assistant-tool', name: 'Read' },
      { type: 'assistant-text', text: 'answer one' },
      { type: 'user', text: 'second question' },
      { type: 'assistant-text', text: 'answer two' },
    ])
    const { status, stderr } = runHook(dir, transcript)
    expect(status).toBe(2)
    expect(stderr).toContain('VERIFY_GROUNDING_GATE_FIRED')
  })

  it('passes through when AUDIT marker is already in recent transcript', () => {
    // Simulate that the hook already fired the audit and Claude responded.
    const transcript = writeTranscript(dir, [
      { type: 'user', text: 'question' },
      { type: 'assistant-tool', name: 'Read' },
      { type: 'assistant-text', text: 'first answer' },
      // Hook's audit stderr gets echoed into the transcript as synthetic user content.
      { type: 'user', text: 'VERIFY_GROUNDING_AUDIT_FIRED' },
      { type: 'assistant-text', text: 'audited answer' },
    ])
    const { status } = runHook(dir, transcript)
    expect(status).toBe(0)
  })

  it('re-fires GATE when Claude still has not done research after the first gate', () => {
    // Previous turn: GATE fired, Claude wrote a reply without doing research.
    const transcript = writeTranscript(dir, [
      { type: 'user', text: 'question' },
      { type: 'assistant-text', text: 'first answer' },
      { type: 'user', text: 'VERIFY_GROUNDING_GATE_FIRED' },
      { type: 'assistant-text', text: 'second answer, still no research' },
    ])
    const { status, stderr } = runHook(dir, transcript)
    expect(status).toBe(2)
    expect(stderr).toContain('VERIFY_GROUNDING_GATE_FIRED')
  })
})
