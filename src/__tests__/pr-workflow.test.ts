import { describe, expect, it } from 'vitest'
import {
  buildGhPrListArgs,
  buildGhPrMergeArgs,
  buildGhPrViewArgs,
  detailFromPr,
  formatLandingPackets,
  mergeBlockers,
  packetizePullRequests,
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

})
