import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bdCreateGate } from '../hooks/handlers/bd-create-gate.js'
import type { HookInput } from '../hooks/types.js'

const RUBRIC_SRC = resolve(__dirname, '..', '..', 'templates', 'bd', 'ticket-rubric.json')
const PARSE_SRC = resolve(__dirname, '..', '..', 'templates', 'bd', 'dsl', 'parse.mjs')

describe('bd-create-gate', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bd-gate-test-'))
    spawnSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
    mkdirSync(join(dir, '.beads/dsl'), { recursive: true })
    copyFileSync(RUBRIC_SRC, join(dir, '.beads/ticket-rubric.json'))
    copyFileSync(PARSE_SRC, join(dir, '.beads/dsl/parse.mjs'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function run(command: string) {
    return bdCreateGate({ cwd: dir, tool_input: { command } } as HookInput)
  }

  it('allows non-`bd create` commands', () => {
    expect(run('git status').kind).toBe('allow')
    expect(run('bd ready').kind).toBe('allow')
    expect(run('bd show foo').kind).toBe('allow')
  })

  it('allows epic with valid DSL frontmatter', () => {
    const body = `---
type: epic
domain: auth.sso
artifact: "Auth0 universal-login replaces password form"
out_of_scope:
  - GitHub OAuth
  - SAML
ac:
  - "WHEN user clicks /login THE SYSTEM SHALL redirect to Auth0"
---
Goal sentence.`
    const cmd = `bd create --type=epic --title="t" --silent --body-file=- <<'EOF'\n${body}\nEOF`
    expect(run(cmd).kind).toBe('allow')
  })

  it('blocks epic missing domain', () => {
    const body = `---
type: epic
artifact: "thing"
out_of_scope:
  - x
---
body`
    const cmd = `bd create --type=epic --title="t" --silent --body-file=- <<'EOF'\n${body}\nEOF`
    const r = run(cmd)
    expect(r.kind).toBe('block')
    expect((r as { reason: string }).reason).toContain('epic.domain')
  })

  it('blocks epic missing out_of_scope', () => {
    const body = `---
type: epic
domain: auth.sso
artifact: "thing"
---
body`
    const cmd = `bd create --type=epic --title="t" --silent --body-file=- <<'EOF'\n${body}\nEOF`
    const r = run(cmd)
    expect(r.kind).toBe('block')
    expect((r as { reason: string }).reason).toContain('epic.out_of_scope')
  })

  it('blocks task missing files[]', () => {
    const body = `---
type: task
verify:
  - bun test
ac:
  - "WHEN x THE SYSTEM SHALL y"
---
body`
    const cmd = `bd create --type=task --title="t" --silent --body-file=- <<'EOF'\n${body}\nEOF`
    const r = run(cmd)
    expect(r.kind).toBe('block')
    expect((r as { reason: string }).reason).toContain('task.files')
  })

  it('blocks task missing verify[]', () => {
    const body = `---
type: task
files:
  - src/foo.ts
ac:
  - "WHEN x THE SYSTEM SHALL y"
---
body`
    const cmd = `bd create --type=task --title="t" --silent --body-file=- <<'EOF'\n${body}\nEOF`
    const r = run(cmd)
    expect(r.kind).toBe('block')
    expect((r as { reason: string }).reason).toContain('task.verify')
  })

  it('allows --gate-bypass with logging', () => {
    const body = `---
type: epic
---
empty`
    const cmd = `bd create --type=epic --gate-bypass --design "spec-verifier filed this" --title="t" --silent --body-file=- <<'EOF'\n${body}\nEOF`
    expect(run(cmd).kind).toBe('allow')
  })

  it('allows (legacy passthrough) when body has no DSL frontmatter', () => {
    const body = `## User story\nAs dev I want X.\n\n## Acceptance Criteria\n1. WHEN x THE SYSTEM SHALL y.`
    const cmd = `bd create --type=task --title="t" --silent --body-file=- <<'EOF'\n${body}\nEOF`
    expect(run(cmd).kind).toBe('allow')
  })
})
