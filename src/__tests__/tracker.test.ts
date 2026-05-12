import { describe, expect, it } from 'vitest'
import {
  approvalHashInput,
  computeApprovalHash,
  defaultWorkflowMetadata,
  normalizeBeadsIssue,
  parseWorkflowMetadata,
} from '../tracker.js'

describe('tracker workflow metadata', () => {
  it('validates and normalizes workflow metadata', () => {
    const workflow = defaultWorkflowMetadata('task', 'review')
    workflow.plan.files = ['src/foo.ts']
    workflow.plan.acceptance = ['WHEN called THE SYSTEM SHALL return foo']
    workflow.plan.verify = ['mise run test']

    expect(parseWorkflowMetadata(workflow)).toMatchObject({
      schema: 1,
      kind: 'task',
      state: 'review',
      plan: {
        files: ['src/foo.ts'],
        verify: ['mise run test'],
      },
    })
  })

  it('rejects invalid workflow state', () => {
    const workflow = { ...defaultWorkflowMetadata(), state: 'maybe' }

    expect(() => parseWorkflowMetadata(workflow)).toThrow('metadata.workflow.state is invalid')
  })

  it('normalizes beads issues through metadata.workflow', () => {
    const workflow = defaultWorkflowMetadata('plan', 'ready')
    workflow.plan.summary = 'Build tracker shim'

    expect(
      normalizeBeadsIssue({
        id: 'bd-123',
        title: 'Tracker shim',
        description: 'Readable summary',
        status: 'open',
        priority: 'P2',
        issue_type: 'epic',
        metadata: { workflow },
      }),
    ).toMatchObject({
      id: 'bd-123',
      priority: 2,
      type: 'epic',
      workflow: {
        kind: 'plan',
        state: 'ready',
        plan: { summary: 'Build tracker shim' },
      },
    })
  })

  it('hashes approved plan input while excluding runtime and approval state', () => {
    const workflow = defaultWorkflowMetadata('task', 'review')
    workflow.plan.summary = 'Fix parser'
    const item = normalizeBeadsIssue({
      id: 'bd-123',
      title: 'Fix parser',
      description: 'Parser rejects valid input.',
      status: 'open',
      priority: 2,
      issue_type: 'bug',
      metadata: { workflow },
    })

    const before = computeApprovalHash(item)
    item.workflow.runtime.branch = 'task/bd-123-fix-parser'
    item.workflow.runtime.commits.push('abc123')
    item.workflow.approval.hash = 'old'
    item.workflow.approval.approved_at = '2026-05-12T00:00:00.000Z'

    expect(approvalHashInput(item)).not.toHaveProperty('runtime')
    expect(approvalHashInput(item)).not.toHaveProperty('approval')
    expect(computeApprovalHash(item)).toBe(before)

    item.workflow.plan.verify.push('mise run test')
    expect(computeApprovalHash(item)).not.toBe(before)
  })
})
