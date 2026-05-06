/**
 * Regression tests for PreToolUse hook noise.
 * Allow-path hooks must be silent; denied actions can still explain themselves
 * on stderr.
 */

import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  let dir = ''

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
      'block-todowrite.sh',
      { cwd: dir, tool_name: 'Read', tool_input: { file_path: 'README.md' } },
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

  it('still blocks TodoWrite', () => {
    const result = runHook('block-todowrite.sh', {
      cwd: dir,
      tool_name: 'TodoWrite',
      tool_input: { todos: [] },
    })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('TodoWrite is blocked')
  })

  it('quiet runner hides infrastructure failures and logs them', () => {
    const failing = join(dir, 'fails.sh')
    writeFileSync(failing, '#!/usr/bin/env bash\necho noisy-out\necho noisy-err >&2\nexit 1\n')
    chmodSync(failing, 0o755)

    const result = spawnSync('bash', [join(HOOKS_DIR, 'run-quiet.sh'), failing], {
      cwd: dir,
      encoding: 'utf8',
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')

    const logPath = join(dir, '.claude', 'hook-errors.log')
    expect(existsSync(logPath)).toBe(true)
    const log = readFileSync(logPath, 'utf8')
    expect(log).toContain('status=1')
    expect(log).toContain('noisy-out')
    expect(log).toContain('noisy-err')
  })

  it('quiet runner preserves policy blocks', () => {
    const blocking = join(dir, 'blocks.sh')
    writeFileSync(blocking, '#!/usr/bin/env bash\necho block-msg >&2\nexit 2\n')
    chmodSync(blocking, 0o755)

    const result = spawnSync('bash', [join(HOOKS_DIR, 'run-quiet.sh'), blocking], {
      cwd: dir,
      encoding: 'utf8',
    })

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('block-msg')
  })
})
