import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { worktreeStopGuard } from '../hooks/handlers/worktree-stop-guard.js'
import type { HookInput } from '../hooks/types.js'

function git(cwd: string, ...args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_PARAMETERS: "'core.hooksPath=/dev/null'" },
  })
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr }
}

function runHook(cwd: string) {
  return worktreeStopGuard({ cwd } as HookInput)
}

describe('worktree-stop-guard', () => {
  let baseDir: string
  let mainRepo: string
  let remoteRepo: string
  let worktreeRoot: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'wsg-'))
    mainRepo = join(baseDir, 'main')
    remoteRepo = join(baseDir, 'remote.git')
    spawnSync('git', ['init', '--bare', remoteRepo])
    spawnSync('git', ['init', '-b', 'main', mainRepo])
    git(mainRepo, 'config', 'user.email', 'test@example.com')
    git(mainRepo, 'config', 'user.name', 'Test')
    git(mainRepo, 'remote', 'add', 'origin', remoteRepo)
    writeFileSync(join(mainRepo, 'README.md'), 'init\n')
    git(mainRepo, 'add', '.')
    git(mainRepo, 'commit', '-m', 'init')
    git(mainRepo, 'push', '-u', 'origin', 'main')
    git(mainRepo, 'remote', 'set-head', 'origin', 'main')

    const worktreeParent = join(mainRepo, '.claude', 'worktrees')
    spawnSync('mkdir', ['-p', worktreeParent])
    worktreeRoot = join(worktreeParent, 'agent-001')
    git(mainRepo, 'worktree', 'add', '-b', 'ticket/abc', worktreeRoot)
    git(worktreeRoot, 'config', 'user.email', 'test@example.com')
    git(worktreeRoot, 'config', 'user.name', 'Test')
  }, 30_000)

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('allows outside any worktree (orchestrator stop)', () => {
    expect(runHook(mainRepo).kind).toBe('allow')
  })

  it('blocks stop with uncommitted changes', () => {
    writeFileSync(join(worktreeRoot, 'foo.txt'), 'wip\n')
    const r = runHook(worktreeRoot)
    expect(r.kind).toBe('block')
    expect((r as { reason: string }).reason).toContain('uncommitted changes')
  })

  it('blocks stop when branch has commits but was never pushed (no upstream)', () => {
    writeFileSync(join(worktreeRoot, 'foo.txt'), 'work\n')
    git(worktreeRoot, 'add', '.')
    git(worktreeRoot, 'commit', '-m', 'feat: work')
    const r = runHook(worktreeRoot)
    expect(r.kind).toBe('block')
    expect((r as { reason: string }).reason).toContain('no upstream')
  })

  it('blocks stop with unpushed commits when upstream exists', () => {
    writeFileSync(join(worktreeRoot, 'foo.txt'), 'work\n')
    git(worktreeRoot, 'add', '.')
    git(worktreeRoot, 'commit', '-m', 'feat: work')
    git(worktreeRoot, 'push', '-u', 'origin', 'ticket/abc')
    writeFileSync(join(worktreeRoot, 'bar.txt'), 'more\n')
    git(worktreeRoot, 'add', '.')
    git(worktreeRoot, 'commit', '-m', 'feat: more')
    const r = runHook(worktreeRoot)
    expect(r.kind).toBe('block')
    expect((r as { reason: string }).reason).toContain('unpushed commits')
  })

  it('allows stop on a clean, fully pushed worktree', () => {
    writeFileSync(join(worktreeRoot, 'foo.txt'), 'work\n')
    git(worktreeRoot, 'add', '.')
    git(worktreeRoot, 'commit', '-m', 'feat: work')
    git(worktreeRoot, 'push', '-u', 'origin', 'ticket/abc')
    const r = runHook(worktreeRoot)
    // bd may not be installed in CI; we only assert the git portion is clean.
    if (r.kind === 'block') {
      expect((r as { reason: string }).reason).toContain('in_progress')
    } else {
      expect(r.kind).toBe('allow')
    }
  })

  it('allows when input cwd is missing (empty input)', () => {
    // Handler falls back to process.cwd() which is not a worktree path
    const r = worktreeStopGuard({} as HookInput)
    expect(r.kind).toBe('allow')
  })
})
