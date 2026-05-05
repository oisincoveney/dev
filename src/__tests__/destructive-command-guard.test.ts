import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const HOOK = resolve(__dirname, '..', '..', 'templates', 'hooks', 'destructive-command-guard.sh')

function hasCmd(name: string): boolean {
  const r = spawnSync('command', ['-v', name], { shell: true, stdio: 'ignore' })
  return r.status === 0
}

const canRun = hasCmd('bash') && hasCmd('jq')

function runHook(command: string): {
  status: number
  stdout: string
  stderr: string
} {
  const input = JSON.stringify({ tool_input: { command } })
  const r = spawnSync('bash', [HOOK], { input, encoding: 'utf8' })
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr }
}

describe.skipIf(!canRun)('destructive-command-guard.sh', () => {
  it('exits 0 for benign commands', () => {
    const r = runHook('git status')
    expect(r.status).toBe(0)
    expect(r.stderr).toBe('')
  })

  it('exits 2 on rm with recursive force flags', () => {
    const r = runHook('rm -rf /tmp/foo')
    expect(r.status).toBe(2)
  })

  it('exits 2 on git push --force', () => {
    const r = runHook('git push --force origin main')
    expect(r.status).toBe(2)
  })

  it('does NOT trigger on destructive substring inside a heredoc body', () => {
    const heredoc = `bd create --type=task --body-file=- <<'EOF'\nblock patterns: rm -rf, git reset --hard, git push --force\nEOF`
    const r = runHook(heredoc)
    expect(r.status).toBe(0)
    expect(r.stderr).toBe('')
  })

  it('does NOT trigger on destructive substring inside an unquoted heredoc body', () => {
    const heredoc = `bd create --body-file=- <<MARK\nrm -rf is irreversible\nMARK`
    const r = runHook(heredoc)
    expect(r.status).toBe(0)
  })

  it('rewrites git commit by stripping --no-verify and emits hookSpecificOutput', () => {
    const r = runHook('git commit -m "msg" --no-verify')
    expect(r.status).toBe(0)
    const parsed = JSON.parse(r.stdout) as {
      hookSpecificOutput?: {
        hookEventName?: string
        permissionDecision?: string
        updatedInput?: { command?: string }
      }
    }
    expect(parsed.hookSpecificOutput?.hookEventName).toBe('PreToolUse')
    expect(parsed.hookSpecificOutput?.permissionDecision).toBe('allow')
    expect(parsed.hookSpecificOutput?.updatedInput?.command).not.toContain('--no-verify')
    expect(parsed.hookSpecificOutput?.updatedInput?.command).toContain('git commit')
  })

  it('rewrites git push by stripping --no-verify', () => {
    const r = runHook('git push --no-verify origin main')
    expect(r.status).toBe(0)
    const parsed = JSON.parse(r.stdout) as {
      hookSpecificOutput?: { updatedInput?: { command?: string } }
    }
    expect(parsed.hookSpecificOutput?.updatedInput?.command).not.toContain('--no-verify')
    expect(parsed.hookSpecificOutput?.updatedInput?.command).toContain('git push')
  })

  it('blocks DROP TABLE statements (case-insensitive)', () => {
    const r = runHook('psql -c "drop table users"')
    expect(r.status).toBe(2)
  })

  it('blocks package publish', () => {
    const r = runHook('npm publish')
    expect(r.status).toBe(2)
  })
})
