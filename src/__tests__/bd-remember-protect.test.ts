import { describe, expect, it } from 'vitest'
import { bdRememberProtect } from '../hooks/handlers/bd-remember-protect.js'
import type { HookInput } from '../hooks/types.js'

function run(command: string) {
  return bdRememberProtect({ tool_input: { command } } as HookInput)
}

describe('bd-remember-protect', () => {
  it('allows bd remember outside the protected namespaces', () => {
    expect(run('bd remember "research:context7"').kind).toBe('allow')
    expect(run('bd remember "feedback:tdd-rule"').kind).toBe('allow')
  })

  it('allows read-only bd memories lookups even on protected namespaces', () => {
    expect(run('bd memories plan-approved:tova-foo:').kind).toBe('allow')
    expect(run('bd memories "plan-approved:"').kind).toBe('allow')
  })

  it('blocks plain bd remember on plan-approved: namespace', () => {
    const r = run('bd remember "plan-approved:tova-sso-001:abc"')
    expect(r.kind).toBe('block')
    expect((r as { reason: string }).reason).toContain('plan-approved:')
  })

  it('blocks plain bd remember on plan-rejected: namespace', () => {
    expect(run('bd remember "plan-rejected:tova-sso-001:scope-too-wide"').kind).toBe('block')
  })

  it('allows bd remember on plan-approved: when env-var marker is set inline', () => {
    expect(run('OISIN_DEV_PLAN_APPROVE=1 bd remember "plan-approved:tova-sso-001:abc"').kind).toBe('allow')
  })

  it('allows bd remember on plan-rejected: when reject marker is set inline', () => {
    expect(run('OISIN_DEV_PLAN_REJECT=1 bd remember "plan-rejected:tova-sso-001:reason"').kind).toBe('allow')
  })

  it('allows bd remember on plan-approved: when regrill marker is set inline', () => {
    expect(run('OISIN_DEV_PLAN_REGRILL=1 bd remember "plan-approved:tova-sso-001:abc"').kind).toBe('allow')
  })

  it('blocks if env-var has wrong value (must be =1)', () => {
    expect(run('OISIN_DEV_PLAN_APPROVE=true bd remember "plan-approved:foo:abc"').kind).toBe('block')
    expect(run('OISIN_DEV_PLAN_APPROVE=0 bd remember "plan-approved:foo:abc"').kind).toBe('block')
  })

  it('allows on unrelated commands', () => {
    expect(run('git status').kind).toBe('allow')
    expect(run('bd ready').kind).toBe('allow')
    expect(run('bd show foo').kind).toBe('allow')
    expect(run('').kind).toBe('allow')
  })
})
