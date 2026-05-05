import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const HOOK = resolve(__dirname, '..', '..', 'templates', 'hooks', 'bd-create-gate.sh')
const RUBRIC_SRC = resolve(__dirname, '..', '..', 'templates', 'bd', 'ticket-rubric.json')
const PARSE_SRC = resolve(__dirname, '..', '..', 'templates', 'bd', 'dsl', 'parse.mjs')

function hasCmd(name: string): boolean {
  const r = spawnSync('command', ['-v', name], { shell: true, stdio: 'ignore' })
  return r.status === 0
}

const canRun = hasCmd('bash') && hasCmd('jq') && hasCmd('node')

describe.skipIf(!canRun)('bd-create-gate.sh', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bd-gate-test-'))
    // Init a fake repo so `git rev-parse --show-toplevel` works.
    spawnSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
    mkdirSync(join(dir, '.beads/dsl'), { recursive: true })
    copyFileSync(RUBRIC_SRC, join(dir, '.beads/ticket-rubric.json'))
    copyFileSync(PARSE_SRC, join(dir, '.beads/dsl/parse.mjs'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function runHook(command: string): { status: number; stderr: string } {
    const input = JSON.stringify({ tool_input: { command } })
    // Stub `bd` on PATH so `command -v bd` succeeds; the gate doesn't actually
    // call bd in body-validation paths.
    const stubBin = join(dir, '.bin')
    mkdirSync(stubBin, { recursive: true })
    writeFileSync(join(stubBin, 'bd'), '#!/usr/bin/env bash\nexit 0\n')
    spawnSync('chmod', ['+x', join(stubBin, 'bd')])
    const env = { ...process.env, PATH: `${stubBin}:${process.env.PATH ?? ''}` }
    const r = spawnSync('bash', [HOOK], { cwd: dir, input, encoding: 'utf8', env })
    return { status: r.status ?? -1, stderr: r.stderr }
  }

  it('exits 0 on non-`bd create` commands', () => {
    expect(runHook('git status').status).toBe(0)
    expect(runHook('bd ready').status).toBe(0)
    expect(runHook('bd show foo').status).toBe(0)
  })

  it('exits 0 on epic with valid DSL frontmatter', () => {
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
    const r = runHook(cmd)
    expect(r.status).toBe(0)
  })

  it('exits 2 on epic missing domain', () => {
    const body = `---
type: epic
artifact: "thing"
out_of_scope:
  - x
---
body`
    const cmd = `bd create --type=epic --title="t" --silent --body-file=- <<'EOF'\n${body}\nEOF`
    const r = runHook(cmd)
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('epic.domain')
  })

  it('exits 2 on epic missing out_of_scope', () => {
    const body = `---
type: epic
domain: auth.sso
artifact: "thing"
---
body`
    const cmd = `bd create --type=epic --title="t" --silent --body-file=- <<'EOF'\n${body}\nEOF`
    const r = runHook(cmd)
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('epic.out_of_scope')
  })

  it('exits 2 on task missing files[]', () => {
    const body = `---
type: task
verify:
  - bun test
ac:
  - "WHEN x THE SYSTEM SHALL y"
---
body`
    const cmd = `bd create --type=task --title="t" --silent --body-file=- <<'EOF'\n${body}\nEOF`
    const r = runHook(cmd)
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('task.files')
  })

  it('exits 2 on task missing verify[]', () => {
    const body = `---
type: task
files:
  - src/foo.ts
ac:
  - "WHEN x THE SYSTEM SHALL y"
---
body`
    const cmd = `bd create --type=task --title="t" --silent --body-file=- <<'EOF'\n${body}\nEOF`
    const r = runHook(cmd)
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('task.verify')
  })

  it('allows --gate-bypass with logging', () => {
    const body = `---
type: epic
---
empty`
    const cmd = `bd create --type=epic --gate-bypass --design "spec-verifier filed this" --title="t" --silent --body-file=- <<'EOF'\n${body}\nEOF`
    const r = runHook(cmd)
    expect(r.status).toBe(0)
  })

  it('exits 0 (legacy passthrough) when body has no DSL frontmatter', () => {
    const body = `## User story\nAs dev I want X.\n\n## Acceptance Criteria\n1. WHEN x THE SYSTEM SHALL y.`
    const cmd = `bd create --type=task --title="t" --silent --body-file=- <<'EOF'\n${body}\nEOF`
    const r = runHook(cmd)
    expect(r.status).toBe(0)
  })
})
