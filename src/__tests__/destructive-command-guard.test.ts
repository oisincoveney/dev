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

  it('blocks git clone', () => {
    const r = runHook('git clone https://github.com/example/repo.git')
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('Full repo clones are blocked')
  })

  it('blocks gh repo clone', () => {
    const r = runHook('gh repo clone example/repo')
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('GitHub repo clones are blocked')
  })

  it('blocks clone destinations under /tmp', () => {
    const r = runHook('git clone https://github.com/example/repo.git /tmp/repo')
    expect(r.status).toBe(2)
  })

  it('blocks clone destinations under /private/tmp', () => {
    const r = runHook('git clone https://github.com/example/repo.git /private/tmp/repo')
    expect(r.status).toBe(2)
  })

  it('blocks cd /tmp followed by clone', () => {
    const r = runHook('cd /tmp && git clone https://github.com/example/repo.git')
    expect(r.status).toBe(2)
  })

  it('blocks repo work with TMPDIR overrides', () => {
    const r = runHook('TMPDIR=/tmp/agent-scratch mise run test')
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('TMPDIR overrides are blocked')
  })

  it('blocks env TMPDIR overrides', () => {
    const r = runHook('env TMPDIR=/private/tmp/agent-scratch bun test')
    expect(r.status).toBe(2)
  })

  it('allows force push on non-protected branches', () => {
    const r = runHook('git push --force-with-lease origin task/abc')
    expect(r.status).toBe(0)
  })

  it('exits 2 on git push to protected branch', () => {
    const r = runHook('git push --force origin main')
    expect(r.status).toBe(2)
  })

  it('exits 2 on git tag push', () => {
    const r = runHook('git push origin --tags')
    expect(r.status).toBe(2)
  })

  it('does NOT trigger on destructive substring inside a heredoc body', () => {
    const heredoc = `bd create --type=task --body-file=- <<'EOF'\nblock patterns: rm -rf, git reset --hard, git push --force, curl https://example.com\nEOF`
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
    const r = runHook('git push --no-verify origin task/abc')
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

  it('blocks curl web lookups', () => {
    const r = runHook('curl https://example.com')
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('curl is not allowed')
  })

  it('blocks curl invoked through command', () => {
    const r = runHook('command curl https://example.com')
    expect(r.status).toBe(2)
  })

  it('allows curl when it is not fetching a website', () => {
    const r = runHook('curl --version')
    expect(r.status).toBe(0)
    expect(r.stderr).toBe('')
  })

  it('allows curl for non-http targets', () => {
    const r = runHook('curl --unix-socket /tmp/app.sock http+unix://health')
    expect(r.status).toBe(0)
  })

  it('allows curl for raw GitHub markdown files', () => {
    const r = runHook('curl https://raw.githubusercontent.com/owner/repo/main/README.md')
    expect(r.status).toBe(0)
    expect(r.stderr).toBe('')
  })

  it('allows curl for GitHub raw code files', () => {
    const r = runHook('curl https://github.com/owner/repo/raw/main/src/index.ts')
    expect(r.status).toBe(0)
  })

  it('allows curl for direct source file URLs', () => {
    const r = runHook('curl https://example.com/app/config.yaml?download=1')
    expect(r.status).toBe(0)
  })

  it('blocks curl for GitHub blob pages', () => {
    const r = runHook('curl https://github.com/owner/repo/blob/main/README.md')
    expect(r.status).toBe(2)
  })
})
