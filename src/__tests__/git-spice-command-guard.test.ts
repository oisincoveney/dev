import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const HOOK = resolve(__dirname, '..', '..', 'templates', 'hooks', 'git-spice-command-guard.sh')

function hasCmd(name: string): boolean {
  const r = spawnSync('command', ['-v', name], { shell: true, stdio: 'ignore' })
  return r.status === 0
}

const canRun = hasCmd('bash') && hasCmd('jq')

function runHook(command: string): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('bash', [HOOK], {
    input: JSON.stringify({ tool_input: { command } }),
    encoding: 'utf8',
  })
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr }
}

describe.skipIf(!canRun)('git-spice-command-guard.sh', () => {
  it.each([
    'git status --short',
    'git diff -- src/index.ts',
    'git log --oneline -5',
    'git branch --show-current',
    'gh pr view 12',
    'gh pr checks 12',
    'git-spice stack submit',
    'gs stack restack',
  ])('allows read-only or git-spice command: %s', (command) => {
    const r = runHook(command)
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')
    expect(r.stderr).toBe('')
  })

  it('blocks direct git commit creation', () => {
    const r = runHook('git commit -m "feat: work"')
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('git-spice owns stack-aware commit creation')
    expect(r.stderr).toContain('git-spice commit create')
  })

  it('blocks direct git commit amend', () => {
    const r = runHook('git commit --amend --no-edit')
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('git-spice owns stack-aware commit amendments')
    expect(r.stderr).toContain('git-spice commit amend')
  })

  it.each([
    ['git push -u origin HEAD', 'git-spice stack submit'],
    ['git -C . push -u origin HEAD', 'git-spice stack submit'],
    ['git rebase main', 'git-spice stack restack'],
    ['git switch task/abc', 'git-spice branch checkout'],
    ['git -C . commit -m "feat: work"', 'git-spice commit create'],
    ['git checkout -b task/abc', 'git-spice branch create'],
    ['git branch task/abc', 'git-spice branch create'],
    ['gh pr create --title test --body test', 'git-spice branch submit'],
    ['gh pr edit 12 --title test', 'git-spice branch submit'],
  ])('blocks stack-owned direct command: %s', (command, replacement) => {
    const r = runHook(command)
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('BLOCKED')
    expect(r.stderr).toContain(replacement)
  })

  it('ignores blocked-looking text inside heredocs', () => {
    const command = `bd create --body-file=- <<'EOF'\ntry git commit, git push, and gh pr create in the docs\nEOF`
    const r = runHook(command)
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')
    expect(r.stderr).toBe('')
  })
})
