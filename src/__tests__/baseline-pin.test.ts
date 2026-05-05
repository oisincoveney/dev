import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { baselineCompare } from '../hooks/handlers/baseline-compare.js'
import { baselinePin } from '../hooks/handlers/baseline-pin.js'
import type { HookInput } from '../hooks/types.js'

const T = 15_000

function git(cwd: string, ...args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_PARAMETERS: "'core.hooksPath=/dev/null'" },
  })
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

describe('baseline-pin + baseline-compare', () => {
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
    baselinePin({ cwd: dir } as HookInput)
    const baseline = JSON.parse(readFileSync(join(dir, '.claude/baseline-failures.json'), 'utf8'))
    expect(baseline.skipped).toBe(true)
  }, T)

  it('writes skipped baseline when working tree is dirty', () => {
    setupRepo(dir)
    writeFileSync(join(dir, 'dirty.txt'), 'uncommitted')
    baselinePin({ cwd: dir } as HookInput)
    const baseline = JSON.parse(readFileSync(join(dir, '.claude/baseline-failures.json'), 'utf8'))
    expect(baseline.skipped).toBe(true)
    expect(baseline.reason).toContain('dirty')
  }, T)

  it('captures empty failing set when baseline test command passes', () => {
    setupRepo(dir)
    writeTestRunner(dir, ['transient-failure-on-feature'])
    git(dir, 'add', '.')
    git(dir, 'commit', '-q', '-m', 'feature commit with new failure')
    baselinePin({ cwd: dir } as HookInput)
    const baseline = JSON.parse(readFileSync(join(dir, '.claude/baseline-failures.json'), 'utf8'))
    expect(baseline.skipped).toBe(false)
    expect(baseline.failing).toEqual([])
  }, T)

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
    baselinePin({ cwd: dir } as HookInput)
    const baseline = JSON.parse(readFileSync(join(dir, '.claude/baseline-failures.json'), 'utf8'))
    expect(baseline.skipped).toBe(false)
    expect(baseline.failing).toContain('old-failure')
    expect(baseline.failing).not.toContain('new-regression')
  }, T)

  it('returns to original branch after baseline capture', () => {
    setupRepo(dir)
    writeTestRunner(dir, ['x'])
    git(dir, 'add', '.')
    git(dir, 'commit', '-q', '-m', 'feature')
    baselinePin({ cwd: dir } as HookInput)
    const branch = git(dir, 'rev-parse', '--abbrev-ref', 'HEAD').stdout.trim()
    expect(branch).toBe('feature')
  }, T)

  it('compare allows when baseline is missing', () => {
    setupRepo(dir)
    expect(baselineCompare({ cwd: dir } as HookInput).kind).toBe('allow')
  }, T)

  it('compare allows when baseline is skipped', () => {
    setupRepo(dir)
    const claudeDir = join(dir, '.claude')
    mkdirSync(claudeDir, { recursive: true })
    writeFileSync(
      join(claudeDir, 'baseline-failures.json'),
      JSON.stringify({ skipped: true, reason: 'dirty' }),
    )
    expect(baselineCompare({ cwd: dir } as HookInput).kind).toBe('allow')
  }, T)

  it('compare allows when current failures match baseline (no regression)', () => {
    setupRepo(dir)
    writeTestRunner(dir, ['known-failure'])
    git(dir, 'add', '.')
    git(dir, 'commit', '-q', '-m', 'feature with known failure')
    const claudeDir = join(dir, '.claude')
    mkdirSync(claudeDir, { recursive: true })
    writeFileSync(
      join(claudeDir, 'baseline-failures.json'),
      JSON.stringify({ skipped: false, failing: ['known-failure'] }),
    )
    expect(baselineCompare({ cwd: dir } as HookInput).kind).toBe('allow')
  }, T)

  it('compare blocks with regression delta when a new test fails', () => {
    setupRepo(dir)
    writeTestRunner(dir, ['baseline-failure', 'brand-new-regression'])
    git(dir, 'add', '.')
    git(dir, 'commit', '-q', '-m', 'feature with new regression')
    const claudeDir = join(dir, '.claude')
    mkdirSync(claudeDir, { recursive: true })
    writeFileSync(
      join(claudeDir, 'baseline-failures.json'),
      JSON.stringify({ skipped: false, failing: ['baseline-failure'] }),
    )
    const r = baselineCompare({ cwd: dir } as HookInput)
    expect(r.kind).toBe('block')
    expect((r as { reason: string }).reason).toContain('brand-new-regression')
    expect((r as { reason: string }).reason).not.toContain('baseline-failure')
  }, T)

  it('writes baseline file even when .claude does not exist yet', () => {
    setupRepo(dir)
    expect(existsSync(join(dir, '.claude'))).toBe(false)
    baselinePin({ cwd: dir } as HookInput)
    expect(existsSync(join(dir, '.claude/baseline-failures.json'))).toBe(true)
  }, T)
})
