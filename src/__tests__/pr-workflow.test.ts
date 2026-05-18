import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  buildBacklogTaskArgs,
  buildBacklogTaskInvocations,
  buildFixSpawnInvocation,
  buildGhPrListArgs,
  buildGhPrMergeArgs,
  buildGhPrViewArgs,
  detailFromPr,
  extractBacklogTaskId,
  formatLandingPackets,
  mergeBlockers,
  newSignals,
  packetizePullRequests,
  signalFromWebhook,
  signalsFromPackets,
  type PrSignal,
  verifyWebhookSignature,
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

  it('builds rich PR context queries for per-PR review and file details', () => {
    const args = buildGhPrViewArgs(42, 'example/repo')

    expect(args).toEqual([
      'pr',
      'view',
      '42',
      '--json',
      expect.stringContaining('reviews'),
      '--repo',
      'example/repo',
    ])
    expect(args[4]).toContain('files')
    expect(args[4]).toContain('body')
    expect(args[4]).toContain('comments')
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

  it('formats rich details with files, reviews, comments, and truncated diff', () => {
    const packets = packetizePullRequests(rawPrs)
    const detail = detailFromPr(
      {
        number: 42,
        body: 'Body',
        labels: [{ name: 'agent' }],
        files: [{ path: 'src/pr-workflow.ts' }],
        commits: [{ oid: 'abc123' }],
        comments: [{ body: 'Inline concern', author: { login: 'oisin' }, createdAt: '2026-05-18T10:00:00Z' }],
        reviews: [{ state: 'CHANGES_REQUESTED', body: 'Fix it', author: { login: 'reviewer' }, submittedAt: '2026-05-18T10:05:00Z' }],
      },
      ['diff --git a/file b/file', '+added', '-removed'].join('\n'),
      2,
    )

    const output = formatLandingPackets(packets, new Map([[42, detail]]))

    expect(output).toContain('labels: agent')
    expect(output).toContain('files: src/pr-workflow.ts')
    expect(output).toContain('review detail: CHANGES_REQUESTED by reviewer')
    expect(output).toContain('latest comments: oisin: Inline concern')
    expect(output).toContain('... diff truncated')
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

  it('builds guarded merge commands only for approved clean packets', () => {
    const packets = packetizePullRequests(rawPrs)
    expect(mergeBlockers(packets[0]!)).toContain('review decision CHANGES_REQUESTED')
    expect(mergeBlockers(packets[1]!)).toEqual([])
    expect(buildGhPrMergeArgs(packets[1]!, { repo: 'example/repo', mergeMethod: 'squash', deleteBranch: true })).toEqual([
      'pr',
      'merge',
      '43',
      '--squash',
      '--delete-branch',
      '--repo',
      'example/repo',
    ])
  })

  it('builds Worktrunk spawn commands for daemon-created fix work', () => {
    expect(extractBacklogTaskId('Task DEV-7 - Fix PR #42 feedback')).toBe('DEV-7')

    const invocation = buildFixSpawnInvocation(signal, 'DEV-7', undefined)
    expect(invocation.command).toBe('sh')
    expect(invocation.args[1]).toContain('wt switch --create')
    expect(invocation.args[1]).toContain('task/dev-7-42-feedback')

    const custom = buildFixSpawnInvocation(signal, 'DEV-7', 'agent --task {task} --pr {pr} --branch {branch}')
    expect(custom.args[1]).toBe('agent --task DEV-7 --pr 42 --branch task/dev-7-42-feedback')
  })

  it('converts GitHub webhook review and comment events into daemon signals', () => {
    expect(
      signalFromWebhook('pull_request_review', {
        pull_request: { number: 42, title: 'Fix review workflow', html_url: 'https://github.com/example/repo/pull/42' },
        review: {
          id: 99,
          state: 'changes_requested',
          body: 'Fix this now.',
          submitted_at: '2026-05-18T10:00:00Z',
          user: { login: 'oisin' },
        },
      }),
    ).toMatchObject({
      kind: 'changes_requested',
      prNumber: 42,
      author: 'oisin',
    })

    expect(
      signalFromWebhook('issue_comment', {
        issue: {
          number: 42,
          title: 'Fix review workflow',
          html_url: 'https://github.com/example/repo/pull/42',
          pull_request: { url: 'https://api.github.com/repos/example/repo/pulls/42' },
        },
        comment: {
          id: 100,
          body: 'Please update.',
          created_at: '2026-05-18T10:01:00Z',
          user: { login: 'reviewer' },
        },
      }),
    ).toMatchObject({
      kind: 'comment',
      prNumber: 42,
      author: 'reviewer',
    })
  })

  it('validates optional GitHub webhook signatures', () => {
    const body = '{"ok":true}'
    const secret = 'secret'
    const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

    expect(verifyWebhookSignature(body, signature, secret)).toBe(true)
    expect(verifyWebhookSignature(body, 'sha256=bad', secret)).toBe(false)
    expect(verifyWebhookSignature(body, undefined, undefined)).toBe(true)
  })
})
