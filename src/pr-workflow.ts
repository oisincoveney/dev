import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createInterface } from 'node:readline/promises'

const PR_JSON_FIELDS = [
  'additions',
  'author',
  'baseRefName',
  'changedFiles',
  'comments',
  'commits',
  'deletions',
  'files',
  'headRefName',
  'isDraft',
  'latestReviews',
  'mergeStateStatus',
  'mergeable',
  'number',
  'reviewDecision',
  'state',
  'statusCheckRollup',
  'title',
  'updatedAt',
  'url',
] as const

const DEFAULT_DECISION_FILE = '.agents/pr-landing-decisions.json'
const DEFAULT_DIFF_LINES = 120

const PR_DETAIL_JSON_FIELDS = [
  'additions',
  'author',
  'baseRefName',
  'body',
  'changedFiles',
  'comments',
  'commits',
  'deletions',
  'files',
  'headRefName',
  'isDraft',
  'labels',
  'latestReviews',
  'mergeStateStatus',
  'mergeable',
  'number',
  'reviewDecision',
  'reviews',
  'state',
  'statusCheckRollup',
  'title',
  'updatedAt',
  'url',
] as const

export interface CommandResult {
  status: number
  stdout: string
  stderr: string
  error?: Error
}

export type CommandRunner = (command: string, args: ReadonlyArray<string>) => CommandResult

export interface PullRequestPacket {
  number: number
  title: string
  url: string
  author: string
  branch: string
  base: string
  isDraft: boolean
  changedFiles: number
  additions: number
  deletions: number
  reviewDecision: string
  mergeStateStatus: string
  mergeable: string
  checkSummary: string
  commentCount: number
  reviewCount: number
  recommendation: 'merge' | 'fix' | 'review' | 'defer'
  reasons: string[]
}

export interface PullRequestDetail {
  number: number
  body: string
  files: string[]
  commits: string[]
  labels: string[]
  comments: Array<{ author: string; body: string; createdAt: string }>
  reviews: Array<{ author: string; state: string; body: string; createdAt: string }>
  diff?: string
  diffTruncated: boolean
}

export type LandingDecisionAction = 'merge' | 'fix' | 'review' | 'defer' | 'skip'

export interface LandingDecision {
  prNumber: number
  title: string
  url: string
  action: LandingDecisionAction
  recommendation: PullRequestPacket['recommendation']
  createdAt: string
  merged: boolean
  mergeError?: string
}

interface LandPrsOptions {
  limit: number
  json: boolean
  repo?: string
  interactive: boolean
  details: boolean
  diff: boolean
  diffLines: number
  mergeApproved: boolean
  autoMergeReady: boolean
  mergeMethod: 'squash' | 'merge' | 'rebase'
  deleteBranch: boolean
  decisionFile: string
}

export function buildGhPrListArgs(options: { limit: number; repo?: string }): string[] {
  const args = ['pr', 'list', '--state', 'open', '--limit', String(options.limit), '--json', PR_JSON_FIELDS.join(',')]
  if (options.repo !== undefined) args.push('--repo', options.repo)
  return args
}

export function buildGhPrViewArgs(number: number, repo?: string): string[] {
  const args = ['pr', 'view', String(number), '--json', PR_DETAIL_JSON_FIELDS.join(',')]
  if (repo !== undefined) args.push('--repo', repo)
  return args
}

export function buildGhPrDiffArgs(number: number, repo?: string): string[] {
  const args = ['pr', 'diff', String(number)]
  if (repo !== undefined) args.push('--repo', repo)
  return args
}

export function buildGhPrMergeArgs(
  packet: PullRequestPacket,
  options: Pick<LandPrsOptions, 'repo' | 'mergeMethod' | 'deleteBranch'>,
): string[] {
  const args = ['pr', 'merge', String(packet.number), `--${options.mergeMethod}`]
  if (options.deleteBranch) args.push('--delete-branch')
  if (options.repo !== undefined) args.push('--repo', options.repo)
  return args
}

export function packetizePullRequests(input: unknown): PullRequestPacket[] {
  if (!Array.isArray(input)) return []
  return input.map(toPacket).filter((packet): packet is PullRequestPacket => packet !== null)
}

export function detailFromPr(input: unknown, diff?: string, diffLines = DEFAULT_DIFF_LINES): PullRequestDetail {
  const pr = objectRecord(input)
  const rawDiffLines = diff === undefined ? [] : diff.split('\n')
  const keptDiff = rawDiffLines.length > diffLines ? rawDiffLines.slice(0, diffLines).join('\n') : diff
  return {
    number: numberValue(pr.number, 0),
    body: stringValue(pr.body, ''),
    files: arrayValue(pr.files)
      .map((file) => stringValue(objectRecord(file).path, ''))
      .filter((path) => path.length > 0),
    commits: arrayValue(pr.commits)
      .map((commit) => {
        const row = objectRecord(commit)
        return stringValue(row.oid ?? row.abbreviatedOid ?? row.messageHeadline, '')
      })
      .filter((commit) => commit.length > 0),
    labels: arrayValue(pr.labels)
      .map((label) => stringValue(objectRecord(label).name, ''))
      .filter((label) => label.length > 0),
    comments: arrayValue(pr.comments).map((comment) => {
      const row = objectRecord(comment)
      return {
        author: login(row.author),
        body: stringValue(row.body, ''),
        createdAt: stringValue(row.createdAt ?? row.updatedAt, ''),
      }
    }),
    reviews: arrayValue(pr.reviews ?? pr.latestReviews).map((review) => {
      const row = objectRecord(review)
      return {
        author: login(row.author),
        state: stringValue(row.state, ''),
        body: stringValue(row.body, ''),
        createdAt: stringValue(row.submittedAt ?? row.createdAt ?? row.updatedAt, ''),
      }
    }),
    ...(keptDiff === undefined ? {} : { diff: keptDiff }),
    diffTruncated: rawDiffLines.length > diffLines,
  }
}

export function formatLandingPackets(
  packets: ReadonlyArray<PullRequestPacket>,
  details: ReadonlyMap<number, PullRequestDetail> = new Map(),
): string {
  if (packets.length === 0) return 'No open PRs found.\n'
  return `${packets.map((packet) => formatPacket(packet, details.get(packet.number))).join('\n\n')}\n`
}

export function mergeBlockers(packet: PullRequestPacket): string[] {
  const blockers: string[] = []
  if (packet.isDraft) blockers.push('draft')
  if (packet.reviewDecision !== 'APPROVED') blockers.push(`review decision ${packet.reviewDecision}`)
  if (packet.mergeStateStatus !== 'CLEAN') blockers.push(`merge state ${packet.mergeStateStatus}`)
  if (packet.mergeable !== 'MERGEABLE' && packet.mergeable !== 'UNKNOWN') blockers.push(`mergeable ${packet.mergeable}`)
  if (hasFailingChecks(packet.checkSummary) || hasPendingChecks(packet.checkSummary)) blockers.push(`checks ${packet.checkSummary}`)
  if (packet.recommendation !== 'merge') blockers.push(`recommendation ${packet.recommendation}`)
  return blockers
}

export async function runLandPrs(argv: ReadonlyArray<string>, runner: CommandRunner = runCommand): Promise<void> {
  const options = parseLandPrsOptions(argv)
  if (argv.includes('--help') || argv.includes('-h')) {
    printLandPrsHelp()
    return
  }
  const raw = loadOpenPullRequests(options.limit, options.repo, runner)
  const packets = packetizePullRequests(raw)
  const details = options.details || options.diff || options.interactive ? loadDetailsForPackets(packets, options, runner) : new Map()
  process.stdout.write(options.json ? `${JSON.stringify(withDetails(packets, details), null, 2)}\n` : formatLandingPackets(packets, details))
  if (options.interactive) {
    await runInteractiveLanding(packets, options, runner)
    return
  }
  if (options.mergeApproved && options.autoMergeReady) {
    mergeReadyPackets(packets, options, runner)
  }
}

function loadOpenPullRequests(limit: number, repo: string | undefined, runner: CommandRunner): unknown {
  const result = runner('gh', buildGhPrListArgs({ limit, repo }))
  if (result.error !== undefined) throw new Error(`gh failed to start: ${result.error.message}`)
  if (result.status !== 0) throw new Error(result.stderr.trim() || `gh exited ${result.status}`)
  try {
    return JSON.parse(result.stdout) as unknown
  } catch (err) {
    throw new Error(`gh returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function loadPullRequestDetail(packet: PullRequestPacket, options: LandPrsOptions, runner: CommandRunner): PullRequestDetail {
  const result = runner('gh', buildGhPrViewArgs(packet.number, options.repo))
  if (result.error !== undefined) throw new Error(`gh failed to start: ${result.error.message}`)
  if (result.status !== 0) throw new Error(result.stderr.trim() || `gh pr view exited ${result.status}`)
  let parsed: unknown
  try {
    parsed = JSON.parse(result.stdout) as unknown
  } catch (err) {
    throw new Error(`gh pr view returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!options.diff) return detailFromPr(parsed)
  const diffResult = runner('gh', buildGhPrDiffArgs(packet.number, options.repo))
  if (diffResult.error !== undefined) throw new Error(`gh failed to start: ${diffResult.error.message}`)
  if (diffResult.status !== 0) throw new Error(diffResult.stderr.trim() || `gh pr diff exited ${diffResult.status}`)
  return detailFromPr(parsed, diffResult.stdout, options.diffLines)
}

function loadDetailsForPackets(
  packets: ReadonlyArray<PullRequestPacket>,
  options: LandPrsOptions,
  runner: CommandRunner,
): Map<number, PullRequestDetail> {
  const details = new Map<number, PullRequestDetail>()
  for (const packet of packets) {
    details.set(packet.number, loadPullRequestDetail(packet, options, runner))
  }
  return details
}

function withDetails(packets: ReadonlyArray<PullRequestPacket>, details: ReadonlyMap<number, PullRequestDetail>): unknown[] {
  return packets.map((packet) => ({ ...packet, ...(details.has(packet.number) ? { details: details.get(packet.number) } : {}) }))
}

function parseLandPrsOptions(argv: ReadonlyArray<string>): LandPrsOptions {
  const mergeMethod = stringFlag(argv, '--merge-method')
  return {
    limit: numberFlag(argv, '--limit', 30),
    json: argv.includes('--json'),
    repo: stringFlag(argv, '--repo'),
    interactive: argv.includes('--interactive'),
    details: argv.includes('--details'),
    diff: argv.includes('--diff'),
    diffLines: numberFlag(argv, '--diff-lines', DEFAULT_DIFF_LINES),
    mergeApproved: argv.includes('--merge-approved'),
    autoMergeReady: argv.includes('--auto-merge-ready'),
    mergeMethod: mergeMethod === 'merge' || mergeMethod === 'rebase' ? mergeMethod : 'squash',
    deleteBranch: argv.includes('--delete-branch'),
    decisionFile: stringFlag(argv, '--decision-file') ?? DEFAULT_DECISION_FILE,
  }
}

async function runInteractiveLanding(
  packets: ReadonlyArray<PullRequestPacket>,
  options: LandPrsOptions,
  runner: CommandRunner,
): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const decisions: LandingDecision[] = []
  try {
    for (const packet of packets) {
      const answer = await rl.question(
        `PR #${packet.number} [${packet.recommendation}] (merge/fix/review/defer/skip/quit): `,
      )
      const action = normalizeDecision(answer, packet.recommendation)
      if (action === 'quit') break
      if (action === 'skip') {
        decisions.push(decisionFor(packet, 'skip', false))
        continue
      }
      if (action === 'merge' && options.mergeApproved) {
        const result = mergePacket(packet, options, runner)
        if (result.ok) {
          decisions.push(decisionFor(packet, action, true))
          process.stdout.write(`Merged PR #${packet.number}.\n`)
        } else {
          decisions.push(decisionFor(packet, action, false, result.error))
          process.stdout.write(`Skipped merge for PR #${packet.number}: ${result.error}\n`)
        }
        continue
      }
      decisions.push(decisionFor(packet, action, false))
      if (action === 'merge') process.stdout.write(`Recorded approval for PR #${packet.number}; pass --merge-approved to merge.\n`)
    }
  } finally {
    rl.close()
  }
  writeLandingDecisions(options.decisionFile, decisions)
}

function normalizeDecision(input: string, fallback: PullRequestPacket['recommendation']): LandingDecisionAction | 'quit' {
  const normalized = input.trim().toLowerCase()
  if (normalized.length === 0) return fallback
  if (['m', 'merge', 'approve', 'approved', 'land'].includes(normalized)) return 'merge'
  if (['f', 'fix', 'changes', 'request-changes'].includes(normalized)) return 'fix'
  if (['r', 'review'].includes(normalized)) return 'review'
  if (['d', 'defer', 'reject', 'hold'].includes(normalized)) return 'defer'
  if (['s', 'skip'].includes(normalized)) return 'skip'
  if (['q', 'quit', 'exit'].includes(normalized)) return 'quit'
  return fallback
}

function mergeReadyPackets(packets: ReadonlyArray<PullRequestPacket>, options: LandPrsOptions, runner: CommandRunner): void {
  for (const packet of packets) {
    if (packet.recommendation !== 'merge') continue
    const result = mergePacket(packet, options, runner)
    process.stdout.write(result.ok ? `Merged PR #${packet.number}.\n` : `Skipped merge for PR #${packet.number}: ${result.error}\n`)
  }
}

function mergePacket(
  packet: PullRequestPacket,
  options: Pick<LandPrsOptions, 'repo' | 'mergeMethod' | 'deleteBranch'>,
  runner: CommandRunner,
): { ok: true } | { ok: false; error: string } {
  const blockers = mergeBlockers(packet)
  if (blockers.length > 0) return { ok: false, error: blockers.join('; ') }
  const result = runner('gh', buildGhPrMergeArgs(packet, options))
  if (result.error !== undefined) return { ok: false, error: result.error.message }
  if (result.status !== 0) return { ok: false, error: result.stderr.trim() || `gh pr merge exited ${result.status}` }
  return { ok: true }
}

function decisionFor(
  packet: PullRequestPacket,
  action: LandingDecisionAction,
  merged: boolean,
  mergeError?: string,
): LandingDecision {
  return {
    prNumber: packet.number,
    title: packet.title,
    url: packet.url,
    action,
    recommendation: packet.recommendation,
    createdAt: new Date().toISOString(),
    merged,
    ...(mergeError === undefined ? {} : { mergeError }),
  }
}

function writeLandingDecisions(path: string, decisions: ReadonlyArray<LandingDecision>): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(decisions, null, 2)}\n`)
}

function numberFlag(argv: ReadonlyArray<string>, name: string, fallback: number): number {
  const value = stringFlag(argv, name)
  if (value === undefined) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function stringFlag(argv: ReadonlyArray<string>, name: string): string | undefined {
  const index = argv.indexOf(name)
  if (index === -1) return undefined
  const value = argv[index + 1]
  return value === undefined || value.startsWith('--') ? undefined : value
}

function toPacket(raw: unknown): PullRequestPacket | null {
  const pr = objectRecord(raw)
  const number = numberValue(pr.number, 0)
  if (number <= 0) return null

  const reasons: string[] = []
  const isDraft = booleanValue(pr.isDraft)
  const reviewDecision = stringValue(pr.reviewDecision, 'UNKNOWN')
  const mergeStateStatus = stringValue(pr.mergeStateStatus, 'UNKNOWN')
  const mergeable = stringValue(pr.mergeable, 'UNKNOWN')
  const checkSummary = summarizeChecks(pr.statusCheckRollup)
  const commentCount = arrayValue(pr.comments).length
  const reviewCount = arrayValue(pr.latestReviews).length

  if (isDraft) reasons.push('draft')
  if (reviewDecision === 'CHANGES_REQUESTED') reasons.push('changes requested')
  if (hasFailingChecks(checkSummary)) reasons.push(checkSummary)
  if (mergeStateStatus !== 'CLEAN' && mergeStateStatus !== 'UNKNOWN') reasons.push(`merge state ${mergeStateStatus}`)
  if (commentCount > 0) reasons.push(`${commentCount} comment(s)`)

  return {
    number,
    title: stringValue(pr.title, `(PR #${number})`),
    url: stringValue(pr.url, ''),
    author: login(pr.author),
    branch: stringValue(pr.headRefName, ''),
    base: stringValue(pr.baseRefName, ''),
    isDraft,
    changedFiles: numberValue(pr.changedFiles, 0),
    additions: numberValue(pr.additions, 0),
    deletions: numberValue(pr.deletions, 0),
    reviewDecision,
    mergeStateStatus,
    mergeable,
    checkSummary,
    commentCount,
    reviewCount,
    recommendation: recommend(isDraft, reviewDecision, checkSummary, mergeStateStatus, commentCount),
    reasons,
  }
}

function recommend(
  isDraft: boolean,
  reviewDecision: string,
  checkSummary: string,
  mergeStateStatus: string,
  commentCount: number,
): PullRequestPacket['recommendation'] {
  if (isDraft) return 'defer'
  if (reviewDecision === 'CHANGES_REQUESTED' || hasFailingChecks(checkSummary)) return 'fix'
  if (mergeStateStatus !== 'CLEAN' && mergeStateStatus !== 'UNKNOWN') return 'fix'
  if (commentCount > 0 || reviewDecision === 'REVIEW_REQUIRED') return 'review'
  return 'merge'
}

function formatPacket(packet: PullRequestPacket, detail: PullRequestDetail | undefined): string {
  const reasons = packet.reasons.length > 0 ? packet.reasons.join('; ') : 'no blockers detected'
  const lines = [
    `PR #${packet.number}: ${packet.title}`,
    `  ${packet.url}`,
    `  ${packet.author} ${packet.branch} -> ${packet.base}`,
    `  ${packet.changedFiles} files, +${packet.additions}/-${packet.deletions}`,
    `  reviews: ${packet.reviewDecision}; checks: ${packet.checkSummary}; merge: ${packet.mergeStateStatus}`,
    `  comments: ${packet.commentCount}; latest reviews: ${packet.reviewCount}`,
    `  recommendation: ${packet.recommendation}`,
    `  reasons: ${reasons}`,
  ]
  if (detail !== undefined) lines.push(...formatDetailLines(detail))
  return lines.join('\n')
}

function formatDetailLines(detail: PullRequestDetail): string[] {
  const lines = [
    `  labels: ${detail.labels.length > 0 ? detail.labels.join(', ') : 'none'}`,
    `  files: ${detail.files.length > 0 ? detail.files.slice(0, 10).join(', ') : 'none'}`,
  ]
  if (detail.files.length > 10) lines[lines.length - 1] += `, ... +${detail.files.length - 10} more`
  if (detail.reviews.length > 0) {
    lines.push(`  review detail: ${detail.reviews.map((review) => `${review.state} by ${review.author}`).join('; ')}`)
  }
  if (detail.comments.length > 0) {
    lines.push(`  latest comments: ${detail.comments.slice(-3).map((comment) => `${comment.author}: ${oneLine(comment.body, 80)}`).join(' | ')}`)
  }
  if (detail.diff !== undefined) {
    lines.push('  diff:')
    lines.push(
      ...detail.diff
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => `    ${line}`),
    )
    if (detail.diffTruncated) lines.push('    ... diff truncated')
  }
  return lines
}

function summarizeChecks(value: unknown): string {
  const record = objectRecord(value)
  const contexts = arrayValue(record.contexts ?? record.nodes)
  if (contexts.length === 0) return 'unknown'
  let pass = 0
  let fail = 0
  let pending = 0
  for (const context of contexts) {
    const row = objectRecord(context)
    const conclusion = stringValue(row.conclusion ?? row.state ?? row.status, '').toUpperCase()
    if (['SUCCESS', 'PASSED', 'COMPLETED', 'NEUTRAL', 'SKIPPED'].includes(conclusion)) pass += 1
    else if (['FAILURE', 'FAILED', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(conclusion)) fail += 1
    else pending += 1
  }
  return `${pass} pass, ${fail} fail, ${pending} pending`
}

function hasFailingChecks(checkSummary: string): boolean {
  return /(^|, )([1-9]\d*) fail/.test(checkSummary)
}

function hasPendingChecks(checkSummary: string): boolean {
  return /(^|, )([1-9]\d*) pending/.test(checkSummary)
}

function login(value: unknown): string {
  const record = objectRecord(value)
  return stringValue(record.login ?? record.name, 'unknown')
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function booleanValue(value: unknown): boolean {
  return value === true
}

function oneLine(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 3)}...`
}

function runCommand(command: string, args: ReadonlyArray<string>): CommandResult {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  return {
    status: typeof result.status === 'number' ? result.status : result.error === undefined ? 0 : 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ...(result.error === undefined ? {} : { error: result.error }),
  }
}

function printLandPrsHelp(): void {
  process.stdout.write(`
@oisincoveney/dev land-prs — Summarize open PRs for HITL landing

Usage:
  oisin-dev land-prs [--limit 30] [--repo owner/name] [--json]
                     [--details] [--diff] [--diff-lines 120]
                     [--interactive] [--decision-file .agents/pr-landing-decisions.json]
                     [--merge-approved] [--auto-merge-ready]
                     [--merge-method squash|merge|rebase] [--delete-branch]

`)
}
