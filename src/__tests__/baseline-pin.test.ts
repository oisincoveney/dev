import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const PIN_HOOK = resolve(__dirname, '..', '..', 'templates', 'hooks', 'baseline-pin.sh')
const COMPARE_HOOK = resolve(__dirname, '..', '..', 'templates', 'hooks', 'baseline-compare.sh')

function hasCmd(name: string): boolean {
  const result = spawnSync('command', ['-v', name], { shell: true, stdio: 'ignore' })
  return result.status === 0
}

const canRun = hasCmd('bash') && hasCmd('jq') && hasCmd('git')

function runHook(hookPath: string, cwd: string): { status: number; stderr: string; stdout: string } {
  const input = JSON.stringify({ cwd })
  const result = spawnSync('bash', [hookPath], { input, encoding: 'utf8' })
  return { status: result.status ?? -1, stderr: result.stderr, stdout: result.stdout }
}

function git(cwd: string, ...args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr }
}

function writeTestRunner(dir: string, failingNames: string[]): void {
  const lines = failingNames.map((n) => `echo "FAIL ${n}"`).join('\n')
  const exitCode = failingNames.length > 0 ? 1 : 0
  const script = `#!/usr/bin/env bash\n${lines}\nexit ${exitCode}\n`
  writeFileSync(join(dir, 'fake-test.sh'), script, { mode: 0o755 })
  writeFileSync(
    join(dir, '.dev.config.json'),
    JSON.stringify({ commands: { test: 'bash fake-test.sh' } }),
  )
}

function setupRepo(dir: string): void {
  git(dir, 'init', '-q', '--initial-branch=main')
  git(dir, 'config', 'user.email', 'test@test')
  git(dir, 'config', 'user.name', 'test')
  writeTestRunner(dir, [])
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'baseline (no failures)')
  git(dir, 'checkout', '-q', '-b', 'feature')
}

describe.skipIf(!canRun)('baseline-pin.sh + baseline-compare.sh', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'baseline-pin-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes skipped baseline when .dev.config.json is missing', () => {
    setupRepo(dir)
    rmSync(join(dir, '.dev.config.json'))
    git(dir, 'add', '.')
    git(dir, 'commit', '-q', '-m', 'remove config', '--allow-empty')
    runHook(PIN_HOOK, dir)
    const baseline = JSON.parse(readFileSync(join(dir, '.claude/baseline-failures.json'), 'utf8'))
    expect(baseline.skipped).toBe(true)
  })

  it('writes skipped baseline when working tree is dirty', () => {
    setupRepo(dir)
    writeFileSync(join(dir, 'dirty.txt'), 'uncommitted')
    runHook(PIN_HOOK, dir)
    const baseline = JSON.parse(readFileSync(join(dir, '.claude/baseline-failures.json'), 'utf8'))
    expect(baseline.skipped).toBe(true)
    expect(baseline.reason).toContain('dirty')
  })

  it('captures empty failing set when baseline test command passes', () => {
    setupRepo(dir)
    writeTestRunner(dir, ['transient-failure-on-feature'])
    git(dir, 'add', '.')
    git(dir, 'commit', '-q', '-m', 'feature commit with new failure')
    runHook(PIN_HOOK, dir)
    const baseline = JSON.parse(readFileSync(join(dir, '.claude/baseline-failures.json'), 'utf8'))
    expect(baseline.skipped).toBe(false)
    expect(baseline.failing).toEqual([])
  })

  it('captures failing-test names when baseline already had failures', () => {
    git(dir, 'init', '-q', '--initial-branch=main')
    git(dir, 'config', 'user.email', 'test@test')
    git(dir, 'config', 'user.name', 'test')
    writeTestRunner(dir, ['old-failure'])
    git(dir, 'add', '.')
    git(dir, 'commit', '-q', '-m', 'baseline with one failing test')
    git(dir, 'checkout', '-q', '-b', 'feature')
    writeTestRunner(dir, ['old-failure', 'new-regression'])
    git(dir, 'add', '.')
    git(dir, 'commit', '-q', '-m', 'feature with regression')
    runHook(PIN_HOOK, dir)
    const baseline = JSON.parse(readFileSync(join(dir, '.claude/baseline-failures.json'), 'utf8'))
    expect(baseline.skipped).toBe(false)
    expect(baseline.failing).toContain('old-failure')
    expect(baseline.failing).not.toContain('new-regression')
  })

  it('returns to original branch after baseline capture', () => {
    setupRepo(dir)
    writeTestRunner(dir, ['x'])
    git(dir, 'add', '.')
    git(dir, 'commit', '-q', '-m', 'feature')
    runHook(PIN_HOOK, dir)
    const branch = git(dir, 'rev-parse', '--abbrev-ref', 'HEAD').stdout.trim()
    expect(branch).toBe('feature')
  })

  it('compare exits 0 when baseline is missing', () => {
    setupRepo(dir)
    const { status } = runHook(COMPARE_HOOK, dir)
    expect(status).toBe(0)
  })

  it('compare exits 0 when baseline is skipped', () => {
    setupRepo(dir)
    const claudeDir = join(dir, '.claude')
    require('node:fs').mkdirSync(claudeDir, { recursive: true })
    writeFileSync(
      join(claudeDir, 'baseline-failures.json'),
      JSON.stringify({ skipped: true, reason: 'dirty' }),
    )
    const { status } = runHook(COMPARE_HOOK, dir)
    expect(status).toBe(0)
  })

  it('compare exits 0 when current failures match baseline (no regression)', () => {
    setupRepo(dir)
    writeTestRunner(dir, ['known-failure'])
    git(dir, 'add', '.')
    git(dir, 'commit', '-q', '-m', 'feature with known failure')
    const claudeDir = join(dir, '.claude')
    require('node:fs').mkdirSync(claudeDir, { recursive: true })
    writeFileSync(
      join(claudeDir, 'baseline-failures.json'),
      JSON.stringify({ skipped: false, failing: ['known-failure'] }),
    )
    const { status } = runHook(COMPARE_HOOK, dir)
    expect(status).toBe(0)
  })

  it('compare exits 2 with regression delta when a new test fails', () => {
    setupRepo(dir)
    writeTestRunner(dir, ['baseline-failure', 'brand-new-regression'])
    git(dir, 'add', '.')
    git(dir, 'commit', '-q', '-m', 'feature with new regression')
    const claudeDir = join(dir, '.claude')
    require('node:fs').mkdirSync(claudeDir, { recursive: true })
    writeFileSync(
      join(claudeDir, 'baseline-failures.json'),
      JSON.stringify({ skipped: false, failing: ['baseline-failure'] }),
    )
    const { status, stderr } = runHook(COMPARE_HOOK, dir)
    expect(status).toBe(2)
    expect(stderr).toContain('brand-new-regression')
    expect(stderr).not.toContain('baseline-failure')
  })

  it('writes baseline file even when .claude does not exist yet', () => {
    setupRepo(dir)
    expect(existsSync(join(dir, '.claude'))).toBe(false)
    runHook(PIN_HOOK, dir)
    expect(existsSync(join(dir, '.claude/baseline-failures.json'))).toBe(true)
  })
})
