import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const HOOK = resolve(__dirname, '..', '..', 'templates', 'hooks', 'worktree-write-guard.sh')

function hasCmd(name: string): boolean {
  const r = spawnSync('command', ['-v', name], { shell: true, stdio: 'ignore' })
  return r.status === 0
}

const canRun = hasCmd('bash') && hasCmd('jq')

interface HookInput {
  cwd?: string
  filePath?: string
}

function runHook({ cwd, filePath }: HookInput): {
  status: number
  stdout: string
  stderr: string
} {
  const payload: Record<string, unknown> = {
    tool_input: filePath !== undefined ? { file_path: filePath } : {},
  }
  if (cwd !== undefined) payload.cwd = cwd
  const r = spawnSync('bash', [HOOK], { input: JSON.stringify(payload), encoding: 'utf8' })
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr }
}

describe.skipIf(!canRun)('worktree-write-guard.sh', () => {
  const WORKTREE = '/Users/x/proj/.claude/worktrees/agent-001'

  it('allows writes outside any worktree (orchestrator context)', () => {
    const r = runHook({ cwd: '/Users/x/proj', filePath: '/Users/x/proj/src/foo.ts' })
    expect(r.status).toBe(0)
    expect(r.stderr).toBe('')
  })

  it('allows absolute writes under the worktree root', () => {
    const r = runHook({ cwd: WORKTREE, filePath: `${WORKTREE}/src/foo.ts` })
    expect(r.status).toBe(0)
    expect(r.stderr).toBe('')
  })

  it('allows absolute writes in nested worktree subdirs', () => {
    const r = runHook({
      cwd: `${WORKTREE}/apps/backend`,
      filePath: `${WORKTREE}/apps/backend/src/foo.ts`,
    })
    expect(r.status).toBe(0)
  })

  it('blocks absolute writes that escape the worktree into the main checkout', () => {
    const r = runHook({ cwd: WORKTREE, filePath: '/Users/x/proj/src/foo.ts' })
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('Worktree write escape blocked')
    expect(r.stderr).toContain(WORKTREE)
    expect(r.stderr).toContain('/Users/x/proj/src/foo.ts')
  })

  it('blocks absolute writes to a sibling worktree', () => {
    const r = runHook({
      cwd: WORKTREE,
      filePath: '/Users/x/proj/.claude/worktrees/agent-002/src/foo.ts',
    })
    expect(r.status).toBe(2)
  })

  it('allows relative paths (resolved against cwd inside the worktree)', () => {
    const r = runHook({ cwd: WORKTREE, filePath: 'src/foo.ts' })
    expect(r.status).toBe(0)
  })

  it('exits 0 when no file path supplied', () => {
    const r = runHook({ cwd: WORKTREE })
    expect(r.status).toBe(0)
  })

  it('exits 0 when input is malformed json', () => {
    const r = spawnSync('bash', [HOOK], { input: 'not json', encoding: 'utf8' })
    expect(r.status).toBe(0)
  })
})
