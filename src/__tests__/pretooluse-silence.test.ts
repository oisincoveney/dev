/**
 * Regression tests for PreToolUse hook noise.
 * Allow-path hooks must be silent; denied actions can still explain themselves
 * on stderr.
 */

import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
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

function runDispatch(
  cwd: string,
  input: Record<string, unknown>,
  env: Record<string, string> = {},
): HookResult {
  const result = spawnSync('bash', [join(HOOKS_DIR, 'pre-tool-dispatch.sh')], {
    cwd,
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, ...env },
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
    symlinkSync(HOOKS_DIR, join(dir, '.claude', 'hooks'), 'dir')
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
      'git-spice-command-guard.sh',
      { cwd: dir, tool_input: { command: 'git status --short' } },
    ],
    [
      'bd-remember-protect.sh',
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

  it.each(['Write', 'write', 'functions.write'])(
    'dispatcher routes %s through TypeScript write guards',
    (toolName) => {
      const result = runDispatch(
        dir,
        {
          tool_name: toolName,
          tool_input: {
            file_path: 'src/example.ts',
            content: 'const value: any = 1\n',
          },
        },
        { OISIN_DEV_TYPESCRIPT: '1' },
      )

      expect(result.status).toBe(2)
      expect(result.stderr).toContain('Style violation')
    },
  )

  it.each(['apply_patch', 'functions.apply_patch'])(
    'dispatcher extracts patch content for %s TypeScript guards',
    (toolName) => {
      const result = runDispatch(
        dir,
        {
          tool_name: toolName,
          tool_input: {
            command:
              '*** Begin Patch\n*** Add File: src/example.ts\n+const value: any = 1\n*** End Patch\n',
          },
        },
        { OISIN_DEV_TYPESCRIPT: '1' },
      )

      expect(result.status).toBe(2)
      expect(result.stderr).toContain('Style violation')
    },
  )

  it('dispatcher extracts patch content for fabricated import checks', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: {} }))
    const result = runDispatch(
      dir,
      {
        tool_name: 'functions.apply_patch',
        tool_input: {
          command:
            '*** Begin Patch\n*** Add File: src/fake.ts\n+import nope from "not-a-real-package"\n+void nope\n*** End Patch\n',
        },
      },
      { OISIN_DEV_TYPESCRIPT: '1' },
    )

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Fabricated imports')
  })

  it.each(['Bash', 'bash', 'functions.exec_command'])(
    'dispatcher routes %s through shell guards',
    (toolName) => {
      const result = runDispatch(dir, {
        tool_name: toolName,
        tool_input: { command: 'rm -rf dist' },
      })

      expect(result.status).toBe(2)
      expect(result.stderr).toContain('BLOCKED')
    },
  )

  it.each(['Bash', 'bash', 'functions.exec_command'])(
    'dispatcher routes %s through git-spice stack guards',
    (toolName) => {
      const result = runDispatch(dir, {
        tool_name: toolName,
        tool_input: { command: 'git commit -m "feat: direct"' },
      })

      expect(result.status).toBe(2)
      expect(result.stderr).toContain('git-spice owns stack-aware commit creation')
    },
  )

  it.each(['TodoWrite', 'todowrite', 'functions.todo_write'])(
    'dispatcher routes %s through TodoWrite guard',
    (toolName) => {
      const result = runDispatch(dir, {
        tool_name: toolName,
        tool_input: { todos: [] },
      })

      expect(result.status).toBe(2)
      expect(result.stderr).toContain('TodoWrite is blocked')
    },
  )

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

  it('quiet runner runs grouped scripts concurrently', () => {
    const first = join(dir, 'first.sh')
    const second = join(dir, 'second.sh')
    writeFileSync(first, '#!/usr/bin/env bash\nsleep 0.8\necho first\n')
    writeFileSync(second, '#!/usr/bin/env bash\nsleep 0.8\necho second\n')
    chmodSync(first, 0o755)
    chmodSync(second, 0o755)

    const started = performance.now()
    const result = spawnSync('bash', [join(HOOKS_DIR, 'run-quiet.sh'), first, second], {
      cwd: dir,
      encoding: 'utf8',
    })
    const elapsed = performance.now() - started

    expect(result.status).toBe(0)
    expect(result.stdout).toBe('first\nsecond\n')
    expect(elapsed).toBeLessThan(1800)
  })

  it('post-edit check is queued quickly and enforced at stop', () => {
    writeFileSync(
      join(dir, 'mise.toml'),
      '[tasks.typecheck]\nrun = "sleep 0.4; printf \'src/example.ts:1: bad\\\\n\'; exit 1"\n',
    )

    const started = performance.now()
    const queued = spawnSync('bash', [join(HOOKS_DIR, 'post-edit-async.sh')], {
      cwd: dir,
      input: JSON.stringify({ tool_input: { file_path: 'src/example.ts' } }),
      encoding: 'utf8',
    })
    const elapsed = performance.now() - started

    expect(queued.status).toBe(0)
    expect(queued.stdout).toBe('')
    expect(queued.stderr).toBe('')
    expect(elapsed).toBeLessThan(300)

    const awaited = spawnSync('bash', [join(HOOKS_DIR, 'post-edit-await.sh')], {
      cwd: dir,
      encoding: 'utf8',
    })

    expect(awaited.status).toBe(2)
    expect(awaited.stderr).toContain('Typecheck errors in src/example.ts')
  })

  it('context injector emits valid UserPromptSubmit JSON', () => {
    spawnSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' })
    const result = spawnSync('bash', [join(HOOKS_DIR, 'context-injector.sh')], {
      cwd: dir,
      input: JSON.stringify({ cwd: dir }),
      encoding: 'utf8',
    })

    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout) as {
      hookSpecificOutput?: { hookEventName?: string; additionalContext?: string }
    }
    expect(parsed.hookSpecificOutput?.hookEventName).toBe('UserPromptSubmit')
    expect(parsed.hookSpecificOutput?.additionalContext).toContain('<turn-context>Branch:')
  })
})
