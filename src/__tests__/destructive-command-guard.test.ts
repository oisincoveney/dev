import { describe, expect, it } from 'vitest'
import { destructiveCommandGuard } from '../hooks/handlers/destructive-command-guard.js'
import type { HookInput } from '../hooks/types.js'

function run(command: string) {
  const input = { tool_input: { command } } as HookInput
  return destructiveCommandGuard(input)
}

describe('destructive-command-guard', () => {
  it('allows benign commands', () => {
    expect(run('git status').kind).toBe('allow')
  })

  it('blocks rm with recursive force flags', () => {
    expect(run('rm -rf /tmp/foo').kind).toBe('block')
  })

  it('blocks git push --force', () => {
    expect(run('git push --force origin main').kind).toBe('block')
  })

  it('does NOT trigger on destructive substring inside a heredoc body', () => {
    const heredoc = `bd create --type=task --body-file=- <<'EOF'\nblock patterns: rm -rf, git reset --hard, git push --force\nEOF`
    expect(run(heredoc).kind).toBe('allow')
  })

  it('does NOT trigger on destructive substring inside an unquoted heredoc body', () => {
    const heredoc = `bd create --body-file=- <<MARK\nrm -rf is irreversible\nMARK`
    expect(run(heredoc).kind).toBe('allow')
  })

  it('blocks --no-verify on git commit', () => {
    const result = run('git commit -m "msg" --no-verify')
    expect(result.kind).toBe('block')
    expect((result as { reason: string }).reason).toContain('--no-verify')
  })

  it('blocks --no-verify on git push', () => {
    const result = run('git push --no-verify origin main')
    expect(result.kind).toBe('block')
    expect((result as { reason: string }).reason).toContain('--no-verify')
  })

  it('blocks DROP TABLE statements (case-insensitive)', () => {
    expect(run('psql -c "drop table users"').kind).toBe('block')
  })

  it('blocks package publish', () => {
    expect(run('npm publish').kind).toBe('block')
  })
})
