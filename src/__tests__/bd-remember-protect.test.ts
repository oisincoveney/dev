import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const HOOK = resolve(__dirname, '..', '..', 'templates', 'hooks', 'bd-remember-protect.sh')

function hasCmd(name: string): boolean {
  const r = spawnSync('command', ['-v', name], { shell: true, stdio: 'ignore' })
  return r.status === 0
}

const canRun = hasCmd('bash') && hasCmd('jq')

function runHook(command: string): { status: number; stderr: string } {
  const input = JSON.stringify({ tool_input: { command } })
  const r = spawnSync('bash', [HOOK], { input, encoding: 'utf8' })
  return { status: r.status ?? -1, stderr: r.stderr }
}

describe.skipIf(!canRun)('bd-remember-protect.sh', () => {
  it('allows bd remember outside the protected namespaces', () => {
    expect(runHook('bd remember "research:context7"').status).toBe(0)
    expect(runHook('bd remember "feedback:tdd-rule"').status).toBe(0)
  })

  it('allows read-only bd memories lookups even on protected namespaces', () => {
    expect(runHook('bd memories plan-approved:tova-foo:').status).toBe(0)
    expect(runHook('bd memories "plan-approved:"').status).toBe(0)
  })

  it('blocks plain bd remember on plan-approved: namespace', () => {
    const r = runHook('bd remember "plan-approved:tova-sso-001:abc"')
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('Reserved bd-remember namespace')
  })

  it('blocks plain bd remember on plan-rejected: namespace', () => {
    const r = runHook('bd remember "plan-rejected:tova-sso-001:scope-too-wide"')
    expect(r.status).toBe(2)
  })

  it('allows bd remember on plan-approved: when env-var marker is set inline', () => {
    expect(
      runHook('OISIN_DEV_PLAN_APPROVE=1 bd remember "plan-approved:tova-sso-001:abc"').status,
    ).toBe(0)
  })

  it('allows bd remember on plan-rejected: when reject marker is set inline', () => {
    expect(
      runHook('OISIN_DEV_PLAN_REJECT=1 bd remember "plan-rejected:tova-sso-001:reason"').status,
    ).toBe(0)
  })

  it('allows bd remember on plan-approved: when regrill marker is set inline', () => {
    expect(
      runHook('OISIN_DEV_PLAN_REGRILL=1 bd remember "plan-approved:tova-sso-001:abc"').status,
    ).toBe(0)
  })

  it('blocks if env-var has wrong value (must be =1)', () => {
    expect(
      runHook('OISIN_DEV_PLAN_APPROVE=true bd remember "plan-approved:foo:abc"').status,
    ).toBe(2)
    expect(
      runHook('OISIN_DEV_PLAN_APPROVE=0 bd remember "plan-approved:foo:abc"').status,
    ).toBe(2)
  })

  it('exits 0 on unrelated commands', () => {
    expect(runHook('git status').status).toBe(0)
    expect(runHook('bd ready').status).toBe(0)
    expect(runHook('bd show foo').status).toBe(0)
    expect(runHook('').status).toBe(0)
  })
})
