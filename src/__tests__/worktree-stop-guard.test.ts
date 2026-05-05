import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const HOOK = resolve(__dirname, '..', '..', 'templates', 'hooks', 'worktree-stop-guard.sh')

function hasCmd(name: string): boolean {
  const r = spawnSync('command', ['-v', name], { shell: true, stdio: 'ignore' })
  return r.status === 0
}

const canRun = hasCmd('bash') && hasCmd('jq') && hasCmd('git')

function git(cwd: string, ...args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr }
}

function runHook(cwd: string): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('bash', [HOOK], {
    input: JSON.stringify({ cwd }),
    encoding: 'utf8',
    env: { ...process.env, PATH: process.env.PATH ?? '' },
  })
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr }
}

describe.skipIf(!canRun)('worktree-stop-guard.sh', () => {
  let baseDir: string
  let mainRepo: string
  let remoteRepo: string
  let worktreeRoot: string

  // `beforeEach` runs ~10 git operations (init bare + init + config + commit +
  // push + worktree add). Default vitest hookTimeout is 10s; under concurrent
  // vitest workers + git fork overhead this drifts over the limit. Bump to 30s.
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

  it('exits 0 outside any worktree (orchestrator stop)', () => {
    const r = runHook(mainRepo)
    expect(r.status).toBe(0)
    expect(r.stderr).toBe('')
  })

  it('blocks stop with uncommitted changes', () => {
    writeFileSync(join(worktreeRoot, 'foo.txt'), 'wip\n')
    const r = runHook(worktreeRoot)
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('uncommitted changes')
  })

  it('blocks stop when branch has commits but was never pushed (no upstream)', () => {
    writeFileSync(join(worktreeRoot, 'foo.txt'), 'work\n')
    git(worktreeRoot, 'add', '.')
    git(worktreeRoot, 'commit', '-m', 'feat: work')
    const r = runHook(worktreeRoot)
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('no upstream')
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
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('unpushed commits')
  })

  it('allows stop on a clean, fully pushed worktree', () => {
    writeFileSync(join(worktreeRoot, 'foo.txt'), 'work\n')
    git(worktreeRoot, 'add', '.')
    git(worktreeRoot, 'commit', '-m', 'feat: work')
    git(worktreeRoot, 'push', '-u', 'origin', 'ticket/abc')
    const r = runHook(worktreeRoot)
    // bd may not be installed in CI; we only assert the git portion is clean.
    // If exit 2 from bd, it should still mention 'in_progress' (and we accept either).
    if (r.status === 2) {
      expect(r.stderr).toContain('in_progress')
    } else {
      expect(r.status).toBe(0)
    }
  })

  it('exits 0 when input cwd is missing', () => {
    const r = spawnSync('bash', [HOOK], { input: '{}', encoding: 'utf8' })
    expect(r.status).toBe(0)
  })
})
