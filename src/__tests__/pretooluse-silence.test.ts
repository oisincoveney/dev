/**
 * Regression tests for PreToolUse hook noise.
 * Allow-path hooks must be silent; denied actions can still explain themselves
 * on stderr.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const HOOKS_DIR = resolve(__dirname, '..', '..', 'templates', 'hooks')

function hasCmd(name: string): boolean {
  const result = spawnSync('command', ['-v', name], { shell: true, stdio: 'ignore' })
  return result.status === 0
}

const canRun = hasCmd('bash') && hasCmd('jq')

interface HookResult {
  status: number
  stdout: string
  stderr: string
}

function runHook(script: string, input: Record<string, unknown>): HookResult {
  const result = spawnSync('bash', [join(HOOKS_DIR, script)], {
    input: JSON.stringify(input),
    encoding: 'utf8',
  })
  return {
    status: result.status ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

describe.skipIf(!canRun)('PreToolUse hook allow paths', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pretooluse-silence-'))
    mkdirSync(join(dir, '.claude'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it.each([
    ['audit-log.sh', { cwd: dir, tool_name: 'Read', tool_input: { file_path: 'README.md' } }],
    [
      'docs-first.sh',
      { cwd: dir, tool_input: { file_path: 'src/example.ts' } },
    ],
    [
      'destructive-command-guard.sh',
      { cwd: dir, tool_input: { command: 'git status --short' } },
    ],
    [
      'bd-remember-protect.sh',
      { cwd: dir, tool_input: { command: 'git status --short' } },
    ],
    [
      'plan-approval-guard.sh',
      { cwd: dir, tool_input: { command: 'git status --short' } },
    ],
    [
      'bd-create-gate.sh',
      { cwd: dir, tool_input: { command: 'git status --short' } },
    ],
    [
      'block-coauthor.sh',
      { cwd: dir, tool_input: { command: 'git status --short' } },
    ],
    [
      'worktree-write-guard.sh',
      { cwd: dir, tool_input: { file_path: 'src/example.ts' } },
    ],
    [
      'require-claim.sh',
      { cwd: dir, tool_input: { file_path: 'README.md' } },
    ],
    [
      'require-swarm.sh',
      { cwd: dir, tool_input: { file_path: 'README.md' } },
    ],
    [
      'ts-style-guard.sh',
      { cwd: dir, tool_input: { file_path: 'src/example.ts', content: 'const answer = 42' } },
    ],
    [
      'import-validator.sh',
      { cwd: dir, tool_input: { file_path: 'src/example.ts', content: 'const answer = 42' } },
    ],
    [
      'ai-antipattern-guard.sh',
      { cwd: dir, tool_input: { file_path: 'src/example.ts', content: 'const answer = 42' } },
    ],
  ])('%s emits nothing when allowing', (script, input) => {
    const result = runHook(script, input)
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
  })

  it('keeps block messages on deny paths', () => {
    const result = runHook('destructive-command-guard.sh', {
      cwd: dir,
      tool_input: { command: 'git reset --hard' },
    })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('BLOCKED')
  })
})
