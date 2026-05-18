import { describe, expect, it } from 'vitest'
import {
  buildBacklogTaskArgs,
  buildBacklogTaskInvocations,
  buildGhPrListArgs,
  formatLandingPackets,
  newSignals,
  packetizePullRequests,
  signalsFromPackets,
  type PrSignal,
} from '../pr-workflow.js'

const rawPrs = [
  {
    number: 42,
    title: 'Fix review workflow',
    url: 'https://github.com/example/repo/pull/42',
    author: { login: 'bot' },
    headRefName: 'agent/fix-review-workflow',
    baseRefName: 'main',
    isDraft: false,
    changedFiles: 3,
    additions: 120,
    deletions: 12,
    reviewDecision: 'CHANGES_REQUESTED',
    mergeStateStatus: 'CLEAN',
    mergeable: 'MERGEABLE',
    statusCheckRollup: {
      contexts: [
        { conclusion: 'SUCCESS' },
        { conclusion: 'FAILURE' },
      ],
    },
    comments: [
      {
        id: 'comment-1',
        body: 'Please use the tracker workflow.',
        createdAt: '2026-05-18T10:00:00Z',
        author: { login: 'oisin' },
      },
    ],
    latestReviews: [
      {
        id: 'review-1',
        state: 'CHANGES_REQUESTED',
        body: 'Needs a daemon test.',
        submittedAt: '2026-05-18T10:05:00Z',
        author: { login: 'reviewer' },
      },
    ],
  },
  {
    number: 43,
    title: 'Ready PR',
    url: 'https://github.com/example/repo/pull/43',
    author: { login: 'agent' },
    headRefName: 'agent/ready',
    baseRefName: 'main',
    isDraft: false,
    changedFiles: 1,
    additions: 8,
    deletions: 2,
    reviewDecision: 'APPROVED',
    mergeStateStatus: 'CLEAN',
    mergeable: 'MERGEABLE',
    statusCheckRollup: {
      contexts: [{ conclusion: 'SUCCESS' }],
    },
    comments: [],
    latestReviews: [],
  },
]

const signal: PrSignal = {
  id: '42:comment:comment-1:Please use the tracker workflow.',
  prNumber: 42,
  prTitle: 'Fix review workflow',
  prUrl: 'https://github.com/example/repo/pull/42',
  kind: 'comment',
  author: 'oisin',
  body: 'Please use the tracker workflow.',
  createdAt: '2026-05-18T10:00:00Z',
}

describe('PR landing workflow', () => {
  it('builds the GitHub CLI query with review, comment, and check fields', () => {
    expect(buildGhPrListArgs({ limit: 10, repo: 'example/repo' })).toEqual([
      'pr',
      'list',
      '--state',
      'open',
      '--limit',
      '10',
      '--json',
      expect.stringContaining('latestReviews'),
      '--repo',
      'example/repo',
    ])
  })

  it('packetizes open PRs into landing recommendations', () => {
    const packets = packetizePullRequests(rawPrs)

    expect(packets).toHaveLength(2)
    expect(packets[0]).toMatchObject({
      number: 42,
      recommendation: 'fix',
      checkSummary: '1 pass, 1 fail, 0 pending',
      commentCount: 1,
      reviewCount: 1,
      reasons: ['changes requested', '1 pass, 1 fail, 0 pending', '1 comment(s)'],
    })
    expect(packets[1]).toMatchObject({
      number: 43,
      recommendation: 'merge',
      reasons: [],
    })
  })

  it('formats a human landing packet', () => {
    const output = formatLandingPackets(packetizePullRequests(rawPrs))

    expect(output).toContain('PR #42: Fix review workflow')
    expect(output).toContain('recommendation: fix')
    expect(output).toContain('PR #43: Ready PR')
    expect(output).toContain('recommendation: merge')
  })

  it('extracts review and comment signals and filters already-seen ones', () => {
    const packets = packetizePullRequests(rawPrs)
    const signals = signalsFromPackets(packets, rawPrs)

    expect(signals).toEqual([
      expect.objectContaining({
        id: '42:review:CHANGES_REQUESTED:review-1:Needs a daemon test.',
        kind: 'changes_requested',
      }),
      expect.objectContaining({
        id: '42:comment:comment-1:Please use the tracker workflow.',
        kind: 'comment',
      }),
    ])
    expect(newSignals(signals, { seenSignals: [signals[0]!.id] })).toEqual([signals[1]])
  })

  it('builds Backlog task invocations with fallbacks for dogfooding', () => {
    expect(buildBacklogTaskArgs(signal)).toEqual([
      'task',
      'create',
      'Fix PR #42 feedback',
      '--description',
      expect.stringContaining('Please use the tracker workflow.'),
      '--priority',
      'medium',
      '--ref',
      'https://github.com/example/repo/pull/42',
      '--plain',
    ])

    expect(buildBacklogTaskInvocations(signal).map((entry) => entry.command)).toEqual(['backlog', 'mise', 'bunx'])
  })
})
