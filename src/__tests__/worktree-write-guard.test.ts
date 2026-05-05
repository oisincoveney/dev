import { describe, expect, it } from 'vitest'
import { worktreeWriteGuard } from '../hooks/handlers/worktree-write-guard.js'
import type { HookInput } from '../hooks/types.js'

const WORKTREE = '/Users/x/proj/.claude/worktrees/agent-001'

function run({ cwd, filePath }: { cwd?: string; filePath?: string }) {
  const input: HookInput = {
    cwd,
    tool_input: filePath !== undefined ? { file_path: filePath } : {},
  } as HookInput
  return worktreeWriteGuard(input)
}

describe('worktree-write-guard', () => {
  it('allows writes outside any worktree (orchestrator context)', () => {
    const r = run({ cwd: '/Users/x/proj', filePath: '/Users/x/proj/src/foo.ts' })
    expect(r.kind).toBe('allow')
  })

  it('allows absolute writes under the worktree root', () => {
    expect(run({ cwd: WORKTREE, filePath: `${WORKTREE}/src/foo.ts` }).kind).toBe('allow')
  })

  it('allows absolute writes in nested worktree subdirs', () => {
    expect(
      run({ cwd: `${WORKTREE}/apps/backend`, filePath: `${WORKTREE}/apps/backend/src/foo.ts` }).kind,
    ).toBe('allow')
  })

  it('blocks absolute writes that escape the worktree into the main checkout', () => {
    const r = run({ cwd: WORKTREE, filePath: '/Users/x/proj/src/foo.ts' })
    expect(r.kind).toBe('block')
    expect((r as { reason: string }).reason).toContain('Worktree write escape blocked')
    expect((r as { reason: string }).reason).toContain(WORKTREE)
    expect((r as { reason: string }).reason).toContain('/Users/x/proj/src/foo.ts')
  })

  it('blocks absolute writes to a sibling worktree', () => {
    const r = run({ cwd: WORKTREE, filePath: '/Users/x/proj/.claude/worktrees/agent-002/src/foo.ts' })
    expect(r.kind).toBe('block')
  })

  it('allows relative paths (resolved against cwd inside the worktree)', () => {
    expect(run({ cwd: WORKTREE, filePath: 'src/foo.ts' }).kind).toBe('allow')
  })

  it('allows when no file path supplied', () => {
    expect(run({ cwd: WORKTREE }).kind).toBe('allow')
  })

  it('allows when input is empty (no cwd, no file path)', () => {
    expect(run({}).kind).toBe('allow')
  })
})
