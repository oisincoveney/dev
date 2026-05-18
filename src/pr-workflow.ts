import { createHmac, timingSafeEqual } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage } from 'node:http'
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

const DEFAULT_DAEMON_STATE = '.agents/pr-daemon-state.json'
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

export interface PrSignal {
  id: string
  prNumber: number
  prTitle: string
  prUrl: string
  kind: 'changes_requested' | 'review' | 'comment'
  author: string
  body: string
  createdAt: string
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

interface DaemonState {
  seenSignals: string[]
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

interface DaemonOptions {
  once: boolean
  dryRun: boolean
  spawn: boolean
  spawnCommand?: string
  intervalSeconds: number
  limit: number
  stateFile: string
  repo?: string
  webhookPort?: number
  webhookPath: string
  webhookSecretEnv: string
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

export function signalsFromPackets(packets: ReadonlyArray<PullRequestPacket>, rawPrs: unknown): PrSignal[] {
  if (!Array.isArray(rawPrs)) return []
  const byNumber = new Map(packets.map((packet) => [packet.number, packet]))
  const signals: PrSignal[] = []
  for (const raw of rawPrs) {
    const pr = objectRecord(raw)
    const number = numberValue(pr.number, 0)
    const packet = byNumber.get(number)
    if (packet === undefined) continue

    for (const review of arrayValue(pr.latestReviews)) {
      const row = objectRecord(review)
      const state = stringValue(row.state, '').toUpperCase()
      if (state.length === 0) continue
      const body = stringValue(row.body, '')
      const createdAt = stringValue(row.submittedAt ?? row.createdAt ?? row.updatedAt, packet.url)
      const author = login(row.author)
      const id = signalId(number, `review:${state}`, row.id ?? row.databaseId ?? createdAt, body)
      signals.push({
        id,
        prNumber: number,
        prTitle: packet.title,
        prUrl: packet.url,
        kind: state === 'CHANGES_REQUESTED' ? 'changes_requested' : 'review',
        author,
        body,
        createdAt,
      })
    }

    for (const comment of arrayValue(pr.comments)) {
      const row = objectRecord(comment)
      const body = stringValue(row.body, '')
      const createdAt = stringValue(row.createdAt ?? row.updatedAt, packet.url)
      const author = login(row.author)
      const id = signalId(number, 'comment', row.id ?? row.databaseId ?? createdAt, body)
      signals.push({
        id,
        prNumber: number,
        prTitle: packet.title,
        prUrl: packet.url,
        kind: 'comment',
        author,
        body,
        createdAt,
      })
    }
  }
  return signals
}

export function newSignals(signals: ReadonlyArray<PrSignal>, state: DaemonState): PrSignal[] {
  const seen = new Set(state.seenSignals)
  return signals.filter((signal) => !seen.has(signal.id))
}

export function signalFromWebhook(event: string, payload: unknown): PrSignal | null {
  const body = objectRecord(payload)
  if (event === 'pull_request_review') {
    const pr = objectRecord(body.pull_request)
    const review = objectRecord(body.review)
    const number = numberValue(pr.number, 0)
    if (number <= 0) return null
    const state = stringValue(review.state, '').toUpperCase()
    if (state.length === 0) return null
    const reviewBody = stringValue(review.body, '')
    const createdAt = stringValue(review.submitted_at ?? review.created_at ?? review.updated_at, '')
    return {
      id: signalId(number, `webhook-review:${state}`, review.id ?? createdAt, reviewBody),
      prNumber: number,
      prTitle: stringValue(pr.title, `(PR #${number})`),
      prUrl: stringValue(pr.html_url ?? pr.url, ''),
      kind: state === 'CHANGES_REQUESTED' ? 'changes_requested' : 'review',
      author: login(review.user),
      body: reviewBody,
      createdAt,
    }
  }
  if (event === 'issue_comment') {
    const issue = objectRecord(body.issue)
    if (objectRecord(issue.pull_request).url === undefined) return null
    const comment = objectRecord(body.comment)
    const number = numberValue(issue.number, 0)
    if (number <= 0) return null
    const commentBody = stringValue(comment.body, '')
    const createdAt = stringValue(comment.created_at ?? comment.updated_at, '')
    return {
      id: signalId(number, 'webhook-comment', comment.id ?? createdAt, commentBody),
      prNumber: number,
      prTitle: stringValue(issue.title, `(PR #${number})`),
      prUrl: stringValue(issue.html_url ?? issue.url, ''),
      kind: 'comment',
      author: login(comment.user),
      body: commentBody,
      createdAt,
    }
  }
  if (event === 'pull_request_review_comment') {
    const pr = objectRecord(body.pull_request)
    const comment = objectRecord(body.comment)
    const number = numberValue(pr.number, 0)
    if (number <= 0) return null
    const commentBody = stringValue(comment.body, '')
    const createdAt = stringValue(comment.created_at ?? comment.updated_at, '')
    return {
      id: signalId(number, 'webhook-review-comment', comment.id ?? createdAt, commentBody),
      prNumber: number,
      prTitle: stringValue(pr.title, `(PR #${number})`),
      prUrl: stringValue(pr.html_url ?? pr.url, ''),
      kind: 'comment',
      author: login(comment.user),
      body: commentBody,
      createdAt,
    }
  }
  return null
}

export function verifyWebhookSignature(body: string, signatureHeader: string | undefined, secret: string | undefined): boolean {
  if (secret === undefined || secret.length === 0) return true
  if (signatureHeader === undefined || !signatureHeader.startsWith('sha256=')) return false
  const expected = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
  const actualBuffer = Buffer.from(signatureHeader)
  const expectedBuffer = Buffer.from(expected)
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}

export function formatLandingPackets(
  packets: ReadonlyArray<PullRequestPacket>,
  details: ReadonlyMap<number, PullRequestDetail> = new Map(),
): string {
  if (packets.length === 0) return 'No open PRs found.\n'
  return `${packets.map((packet) => formatPacket(packet, details.get(packet.number))).join('\n\n')}\n`
}

export function buildBacklogTaskArgs(signal: PrSignal): string[] {
  return [
    'task',
    'create',
    `Fix PR #${signal.prNumber} feedback`,
    '--description',
    [
      `PR: ${signal.prTitle}`,
      `URL: ${signal.prUrl}`,
      `Signal: ${signal.kind}`,
      `Author: ${signal.author}`,
      `Created: ${signal.createdAt}`,
      '',
      signal.body.trim().length > 0 ? signal.body.trim() : '(no body)',
    ].join('\n'),
    '--priority',
    'medium',
    '--ref',
    signal.prUrl,
    '--plain',
  ]
}

export function buildBacklogTaskInvocations(signal: PrSignal): Array<{ command: string; args: string[] }> {
  const args = buildBacklogTaskArgs(signal)
  return [
    { command: 'backlog', args },
    { command: 'mise', args: ['exec', '--', 'backlog', ...args] },
    { command: 'bunx', args: ['--package', 'backlog.md', 'backlog', ...args] },
  ]
}

export function extractBacklogTaskId(output: string): string | undefined {
  return /\b([A-Z][A-Z0-9]+-\d+)\b/.exec(output)?.[1]
}

export function buildFixSpawnInvocation(
  signal: PrSignal,
  taskId: string | undefined,
  commandTemplate: string | undefined,
): { command: string; args: string[] } {
  const branch = branchNameForSignal(signal, taskId)
  if (commandTemplate !== undefined) {
    return {
      command: 'sh',
      args: ['-lc', renderSpawnTemplate(commandTemplate, signal, taskId, branch)],
    }
  }
  const worktreePath = branch.replaceAll('/', '-')
  const script = [
    'repo_root="$(git rev-parse --show-toplevel)"',
    'case "$repo_root" in */.agents/worktrees/*) repo_root="${repo_root%%/.agents/worktrees/*}" ;; esac',
    `WORKTRUNK_WORKTREE_PATH="$repo_root/.agents/worktrees/${worktreePath}" wt switch --create ${shellSingleQuote(branch)} --yes`,
  ].join('; ')
  return { command: 'sh', args: ['-lc', script] }
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

export async function runPrDaemon(argv: ReadonlyArray<string>, runner: CommandRunner = runCommand): Promise<void> {
  const options = parseDaemonOptions(argv)
  if (argv.includes('--help') || argv.includes('-h')) {
    printPrDaemonHelp()
    return
  }

  if (options.webhookPort !== undefined) {
    await runWebhookDaemon(options, runner)
    return
  }

  const runOnce = (): void => {
    const raw = loadOpenPullRequests(options.limit, options.repo, runner)
    const packets = packetizePullRequests(raw)
    const state = readDaemonState(options.stateFile)
    const fresh = newSignals(signalsFromPackets(packets, raw), state)
    for (const signal of fresh) {
      processFreshSignal(signal, options, runner)
    }
    if (!options.dryRun) {
      writeDaemonState(options.stateFile, {
        seenSignals: [...new Set([...state.seenSignals, ...fresh.map((signal) => signal.id)])],
      })
    }
    if (fresh.length === 0) process.stdout.write('No new PR feedback signals.\n')
  }

  runOnce()
  if (options.once) return

  await new Promise<never>(() => {
    setInterval(runOnce, options.intervalSeconds * 1000)
  })
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

function enqueueBacklogTask(signal: PrSignal, runner: CommandRunner): string {
  const failures: string[] = []
  for (const invocation of buildBacklogTaskInvocations(signal)) {
    const result = runner(invocation.command, invocation.args)
    if (result.error !== undefined) {
      failures.push(`${invocation.command}: ${result.error.message}`)
      continue
    }
    if (result.status === 0) return result.stdout
    failures.push(`${invocation.command}: ${result.stderr.trim() || `exited ${result.status}`}`)
  }
  throw new Error(`could not enqueue Backlog task: ${failures.join('; ')}`)
}

function spawnFixWork(
  signal: PrSignal,
  taskId: string | undefined,
  options: Pick<DaemonOptions, 'spawnCommand'>,
  runner: CommandRunner,
): void {
  const invocation = buildFixSpawnInvocation(signal, taskId, options.spawnCommand)
  const result = runner(invocation.command, invocation.args)
  if (result.error !== undefined) throw new Error(`spawn failed to start: ${result.error.message}`)
  if (result.status !== 0) throw new Error(result.stderr.trim() || `spawn exited ${result.status}`)
}

function processFreshSignal(signal: PrSignal, options: Pick<DaemonOptions, 'dryRun' | 'spawn' | 'spawnCommand'>, runner: CommandRunner): void {
  if (options.dryRun) {
    process.stdout.write(`DRY-RUN enqueue ${signal.kind} for PR #${signal.prNumber}: ${signal.prTitle}\n`)
    if (options.spawn) {
      const invocation = buildFixSpawnInvocation(signal, undefined, options.spawnCommand)
      process.stdout.write(`DRY-RUN spawn ${invocation.command} ${invocation.args.join(' ')}\n`)
    }
    return
  }
  const output = enqueueBacklogTask(signal, runner)
  process.stdout.write(`Enqueued ${signal.kind} for PR #${signal.prNumber}: ${signal.prTitle}\n`)
  if (options.spawn) {
    const taskId = extractBacklogTaskId(output)
    spawnFixWork(signal, taskId, options, runner)
    process.stdout.write(`Spawned fix work for PR #${signal.prNumber}${taskId === undefined ? '' : ` (${taskId})`}.\n`)
  }
}

async function runWebhookDaemon(options: DaemonOptions, runner: CommandRunner): Promise<never> {
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== options.webhookPath) {
      response.writeHead(404).end('not found\n')
      return
    }
    let body = ''
    try {
      body = await readRequestBody(request)
      const secret = process.env[options.webhookSecretEnv]
      if (!verifyWebhookSignature(body, request.headers['x-hub-signature-256']?.toString(), secret)) {
        response.writeHead(401).end('bad signature\n')
        return
      }
      const signal = signalFromWebhook(request.headers['x-github-event']?.toString() ?? '', JSON.parse(body) as unknown)
      if (signal === null) {
        response.writeHead(202).end('ignored\n')
        return
      }
      const state = readDaemonState(options.stateFile)
      const fresh = newSignals([signal], state)
      for (const item of fresh) processFreshSignal(item, options, runner)
      if (!options.dryRun && fresh.length > 0) {
        writeDaemonState(options.stateFile, {
          seenSignals: [...new Set([...state.seenSignals, ...fresh.map((item) => item.id)])],
        })
      }
      response.writeHead(202).end(fresh.length === 0 ? 'duplicate\n' : 'accepted\n')
    } catch (err) {
      response.writeHead(400).end(`${err instanceof Error ? err.message : String(err)}\n`)
    }
  })
  await new Promise<void>((resolve) => server.listen(options.webhookPort, resolve))
  process.stdout.write(`PR daemon webhook listening on ${options.webhookPath} at port ${options.webhookPort}.\n`)
  return new Promise<never>(() => undefined)
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    const size = chunks.reduce((sum, item) => sum + item.length, 0)
    if (size > 1024 * 1024) throw new Error('webhook payload too large')
  }
  return Buffer.concat(chunks).toString('utf8')
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

function parseDaemonOptions(argv: ReadonlyArray<string>): DaemonOptions {
  return {
    once: argv.includes('--once'),
    dryRun: argv.includes('--dry-run'),
    spawn: argv.includes('--spawn'),
    spawnCommand: stringFlag(argv, '--spawn-command'),
    intervalSeconds: numberFlag(argv, '--interval', 60),
    limit: numberFlag(argv, '--limit', 30),
    stateFile: stringFlag(argv, '--state-file') ?? DEFAULT_DAEMON_STATE,
    repo: stringFlag(argv, '--repo'),
    webhookPort: optionalNumberFlag(argv, '--webhook-port'),
    webhookPath: stringFlag(argv, '--webhook-path') ?? '/github',
    webhookSecretEnv: stringFlag(argv, '--webhook-secret-env') ?? 'GITHUB_WEBHOOK_SECRET',
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

function optionalNumberFlag(argv: ReadonlyArray<string>, name: string): number | undefined {
  const value = stringFlag(argv, name)
  if (value === undefined) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined
}

function stringFlag(argv: ReadonlyArray<string>, name: string): string | undefined {
  const index = argv.indexOf(name)
  if (index === -1) return undefined
  const value = argv[index + 1]
  return value === undefined || value.startsWith('--') ? undefined : value
}

function readDaemonState(path: string): DaemonState {
  if (!existsSync(path)) return { seenSignals: [] }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    const record = objectRecord(parsed)
    return { seenSignals: arrayValue(record.seenSignals).map((entry) => String(entry)) }
  } catch {
    return { seenSignals: [] }
  }
}

function writeDaemonState(path: string, state: DaemonState): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`)
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

function signalId(prNumber: number, kind: string, rawId: unknown, body: string): string {
  const id = String(rawId ?? '')
  return `${prNumber}:${kind}:${id}:${body.slice(0, 80)}`
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

function branchNameForSignal(signal: PrSignal, taskId: string | undefined): string {
  const prefix = taskId === undefined ? 'pr' : taskId.toLowerCase()
  return `task/${prefix}-${signal.prNumber}-feedback`
}

function renderSpawnTemplate(template: string, signal: PrSignal, taskId: string | undefined, branch: string): string {
  return template
    .replaceAll('{task}', taskId ?? '')
    .replaceAll('{pr}', String(signal.prNumber))
    .replaceAll('{url}', signal.prUrl)
    .replaceAll('{branch}', branch)
    .replaceAll('{title}', signal.prTitle)
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`
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

function printPrDaemonHelp(): void {
  process.stdout.write(`
@oisincoveney/dev pr-daemon — Poll PR feedback and enqueue Backlog fix tasks

Usage:
  oisin-dev pr-daemon [--once] [--dry-run] [--interval 60] [--limit 30]
                      [--repo owner/name] [--state-file .agents/pr-daemon-state.json]
                      [--spawn] [--spawn-command 'command with {task} {pr} {url} {branch}']
                      [--webhook-port 7777] [--webhook-path /github]
                      [--webhook-secret-env GITHUB_WEBHOOK_SECRET]

`)
}
