import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { verifierSkillGuard } from '../hooks/handlers/verifier-skill-guard.js'
import type { HookInput } from '../hooks/types.js'

interface ToolUse {
  name: string
  input: Record<string, unknown>
}

interface TranscriptOptions {
  finalText?: string
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

function runHook(dir: string, transcriptPath: string) {
  return verifierSkillGuard({ cwd: dir, transcript_path: transcriptPath } as HookInput)
}

describe('verifier-skill-guard', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'verifier-skill-guard-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('allows when no completion claim and no bd close', () => {
    const transcript = writeTranscript(dir, {
      finalText: 'Looking into the bug now',
      toolUses: [{ name: 'Edit', input: { file_path: '/tmp/foo.ts' } }],
    })
    expect(runHook(dir, transcript).kind).toBe('allow')
  })

  it('allows when completion is claimed but no files were edited', () => {
    const transcript = writeTranscript(dir, {
      finalText: 'task complete — research wrote up the findings',
      toolUses: [],
    })
    expect(runHook(dir, transcript).kind).toBe('allow')
  })

  it('blocks when claiming completion after editing TS without invoking required skills', () => {
    const transcript = writeTranscript(dir, {
      finalText: 'this is done',
      toolUses: [{ name: 'Edit', input: { file_path: '/tmp/foo.ts' } }],
    })
    const r = runHook(dir, transcript)
    expect(r.kind).toBe('block')
    expect((r as { reason: string }).reason).toContain('code-review')
    expect((r as { reason: string }).reason).toContain('typescript-advanced-types')
  })

  it('blocks on bd close after editing Go without invoking required skills', () => {
    const transcript = writeTranscript(dir, {
      finalText: 'closing the ticket',
      toolUses: [
        { name: 'Edit', input: { file_path: '/tmp/foo.go' } },
        { name: 'Bash', input: { command: 'bd close beads-123' } },
      ],
    })
    const r = runHook(dir, transcript)
    expect(r.kind).toBe('block')
    expect((r as { reason: string }).reason).toContain('code-review')
    expect((r as { reason: string }).reason).toContain('golang-code-style')
    expect((r as { reason: string }).reason).toContain('golang-error-handling')
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
    expect(runHook(dir, transcript).kind).toBe('allow')
  })

  it('passes when verifier subagent (Skill spec-verifier) was invoked', () => {
    const transcript = writeTranscript(dir, {
      finalText: 'task complete!',
      toolUses: [
        { name: 'Edit', input: { file_path: '/tmp/foo.ts' } },
        { name: 'Skill', input: { skill: 'spec-verifier' } },
      ],
    })
    expect(runHook(dir, transcript).kind).toBe('allow')
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
    expect(runHook(dir, transcript).kind).toBe('allow')
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
    const r = runHook(dir, transcript)
    expect(r.kind).toBe('block')
    expect((r as { reason: string }).reason).toContain('nextjs-app-router-patterns')
  })

  it('only requires code-review for non-TS / non-Go edits', () => {
    const transcript = writeTranscript(dir, {
      finalText: 'task is now complete',
      toolUses: [
        { name: 'Edit', input: { file_path: '/tmp/notes.md' } },
        { name: 'Skill', input: { skill: 'code-review' } },
      ],
    })
    expect(runHook(dir, transcript).kind).toBe('allow')
  })

  it('does not match `bd closer` or other near-miss commands as `bd close`', () => {
    const transcript = writeTranscript(dir, {
      finalText: 'looking at it',
      toolUses: [
        { name: 'Edit', input: { file_path: '/tmp/foo.ts' } },
        { name: 'Bash', input: { command: 'bd closely-related-thing' } },
      ],
    })
    expect(runHook(dir, transcript).kind).toBe('allow')
  })
})
