/**
 * Behavioral tests for templates/hooks/verifier-skill-guard.sh.
 * Synthesises a transcript JSONL, then invokes the real shell script.
 * Skipped if bash or jq is unavailable.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const HOOK = resolve(__dirname, '..', '..', 'templates', 'hooks', 'verifier-skill-guard.sh')

function hasCmd(name: string): boolean {
  const result = spawnSync('command', ['-v', name], { shell: true, stdio: 'ignore' })
  return result.status === 0
}

const canRun = hasCmd('bash') && hasCmd('jq')

interface ToolUse {
  name: string
  input: Record<string, unknown>
}

interface TranscriptOptions {
  /** Final assistant message text. Used for completion-claim detection. */
  finalText?: string
  /** Tool calls to splatter across earlier assistant turns. */
  toolUses?: ToolUse[]
}

function writeTranscript(dir: string, options: TranscriptOptions): string {
  const path = join(dir, 'transcript.jsonl')
  const lines: string[] = []

  for (const tu of options.toolUses ?? []) {
    lines.push(
      JSON.stringify({
        type: 'assistant',
        content: [{ type: 'tool_use', name: tu.name, input: tu.input }],
      }),
    )
  }

  if (options.finalText !== undefined) {
    lines.push(
      JSON.stringify({
        type: 'assistant',
        content: [{ type: 'text', text: options.finalText }],
      }),
    )
  }

  writeFileSync(path, `${lines.join('\n')}\n`)
  return path
}

function runHook(dir: string, transcriptPath: string): { status: number; stderr: string } {
  const input = JSON.stringify({ cwd: dir, transcript_path: transcriptPath })
  const result = spawnSync('bash', [HOOK], { input, encoding: 'utf8' })
  return { status: result.status ?? -1, stderr: result.stderr }
}

describe.skipIf(!canRun)('verifier-skill-guard.sh', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'verifier-skill-guard-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('exits 0 when no completion claim and no bd close', () => {
    const transcript = writeTranscript(dir, {
      finalText: 'Looking into the bug now',
      toolUses: [{ name: 'Edit', input: { file_path: '/tmp/foo.ts' } }],
    })
    const { status } = runHook(dir, transcript)
    expect(status).toBe(0)
  })

  it('exits 0 when completion is claimed but no files were edited', () => {
    const transcript = writeTranscript(dir, {
      finalText: 'task complete — research wrote up the findings',
      toolUses: [],
    })
    const { status } = runHook(dir, transcript)
    expect(status).toBe(0)
  })

  it('blocks when claiming completion after editing TS without invoking required skills', () => {
    const transcript = writeTranscript(dir, {
      finalText: 'this is done',
      toolUses: [{ name: 'Edit', input: { file_path: '/tmp/foo.ts' } }],
    })
    const { status, stderr } = runHook(dir, transcript)
    expect(status).toBe(2)
    expect(stderr).toContain('code-review')
    expect(stderr).toContain('typescript-advanced-types')
  })

  it('blocks on bd close after editing Go without invoking required skills', () => {
    const transcript = writeTranscript(dir, {
      finalText: 'closing the ticket',
      toolUses: [
        { name: 'Edit', input: { file_path: '/tmp/foo.go' } },
        { name: 'Bash', input: { command: 'bd close beads-123' } },
      ],
    })
    const { status, stderr } = runHook(dir, transcript)
    expect(status).toBe(2)
    expect(stderr).toContain('code-review')
    expect(stderr).toContain('golang-code-style')
    expect(stderr).toContain('golang-error-handling')
  })

  it('passes when completion claim is preceded by required skill invocations', () => {
    const transcript = writeTranscript(dir, {
      finalText: 'all tests pass',
      toolUses: [
        { name: 'Edit', input: { file_path: '/tmp/foo.ts' } },
        { name: 'Skill', input: { skill: 'code-review' } },
        { name: 'Skill', input: { skill: 'typescript-advanced-types' } },
      ],
    })
    const { status } = runHook(dir, transcript)
    expect(status).toBe(0)
  })

  it('passes when verifier subagent (Skill spec-verifier) was invoked', () => {
    const transcript = writeTranscript(dir, {
      finalText: 'task complete!',
      toolUses: [
        { name: 'Edit', input: { file_path: '/tmp/foo.ts' } },
        { name: 'Skill', input: { skill: 'spec-verifier' } },
      ],
    })
    const { status } = runHook(dir, transcript)
    expect(status).toBe(0)
  })

  it('passes when an Agent was spawned referencing spec-verifier in the prompt', () => {
    const transcript = writeTranscript(dir, {
      finalText: 'this is done',
      toolUses: [
        { name: 'Edit', input: { file_path: '/tmp/foo.go' } },
        {
          name: 'Agent',
          input: {
            subagent_type: 'general-purpose',
            prompt: 'Run the spec-verifier protocol against bd-123 — re-read the issue, load skills...',
          },
        },
      ],
    })
    const { status } = runHook(dir, transcript)
    expect(status).toBe(0)
  })

  it('requires next.js skill when editing under app/', () => {
    const transcript = writeTranscript(dir, {
      finalText: 'this works',
      toolUses: [
        { name: 'Edit', input: { file_path: '/repo/app/page.tsx' } },
        { name: 'Skill', input: { skill: 'code-review' } },
        { name: 'Skill', input: { skill: 'typescript-advanced-types' } },
      ],
    })
    const { status, stderr } = runHook(dir, transcript)
    expect(status).toBe(2)
    expect(stderr).toContain('nextjs-app-router-patterns')
  })

  it('only requires code-review for non-TS / non-Go edits', () => {
    const transcript = writeTranscript(dir, {
      finalText: 'task is now complete',
      toolUses: [
        { name: 'Edit', input: { file_path: '/tmp/notes.md' } },
        { name: 'Skill', input: { skill: 'code-review' } },
      ],
    })
    const { status } = runHook(dir, transcript)
    expect(status).toBe(0)
  })

  it("does not match `bd closer` or other near-miss commands as `bd close`", () => {
    const transcript = writeTranscript(dir, {
      finalText: 'looking at it',
      toolUses: [
        { name: 'Edit', input: { file_path: '/tmp/foo.ts' } },
        { name: 'Bash', input: { command: 'bd closely-related-thing' } },
      ],
    })
    const { status } = runHook(dir, transcript)
    expect(status).toBe(0)
  })
})
