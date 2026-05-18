import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

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

interface DaemonState {
  seenSignals: string[]
}

interface LandPrsOptions {
  limit: number
  json: boolean
  repo?: string
}

interface DaemonOptions {
  once: boolean
  dryRun: boolean
  intervalSeconds: number
  limit: number
  stateFile: string
  repo?: string
}

export function buildGhPrListArgs(options: { limit: number; repo?: string }): string[] {
  const args = ['pr', 'list', '--state', 'open', '--limit', String(options.limit), '--json', PR_JSON_FIELDS.join(',')]
  if (options.repo !== undefined) args.push('--repo', options.repo)
  return args
}

export function packetizePullRequests(input: unknown): PullRequestPacket[] {
  if (!Array.isArray(input)) return []
  return input.map(toPacket).filter((packet): packet is PullRequestPacket => packet !== null)
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

export function formatLandingPackets(packets: ReadonlyArray<PullRequestPacket>): string {
  if (packets.length === 0) return 'No open PRs found.\n'
  return `${packets.map(formatPacket).join('\n\n')}\n`
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

export async function runLandPrs(argv: ReadonlyArray<string>, runner: CommandRunner = runCommand): Promise<void> {
  const options = parseLandPrsOptions(argv)
  if (argv.includes('--help') || argv.includes('-h')) {
    printLandPrsHelp()
    return
  }
  const raw = loadOpenPullRequests(options.limit, options.repo, runner)
  const packets = packetizePullRequests(raw)
  process.stdout.write(options.json ? `${JSON.stringify(packets, null, 2)}\n` : formatLandingPackets(packets))
}

export async function runPrDaemon(argv: ReadonlyArray<string>, runner: CommandRunner = runCommand): Promise<void> {
  const options = parseDaemonOptions(argv)
  if (argv.includes('--help') || argv.includes('-h')) {
    printPrDaemonHelp()
    return
  }

  const runOnce = (): void => {
    const raw = loadOpenPullRequests(options.limit, options.repo, runner)
    const packets = packetizePullRequests(raw)
    const state = readDaemonState(options.stateFile)
    const fresh = newSignals(signalsFromPackets(packets, raw), state)
    for (const signal of fresh) {
      if (options.dryRun) {
        process.stdout.write(`DRY-RUN enqueue ${signal.kind} for PR #${signal.prNumber}: ${signal.prTitle}\n`)
      } else {
        enqueueBacklogTask(signal, runner)
        process.stdout.write(`Enqueued ${signal.kind} for PR #${signal.prNumber}: ${signal.prTitle}\n`)
      }
    }
    writeDaemonState(options.stateFile, {
      seenSignals: [...new Set([...state.seenSignals, ...fresh.map((signal) => signal.id)])],
    })
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

function enqueueBacklogTask(signal: PrSignal, runner: CommandRunner): void {
  const failures: string[] = []
  for (const invocation of buildBacklogTaskInvocations(signal)) {
    const result = runner(invocation.command, invocation.args)
    if (result.error !== undefined) {
      failures.push(`${invocation.command}: ${result.error.message}`)
      continue
    }
    if (result.status === 0) return
    failures.push(`${invocation.command}: ${result.stderr.trim() || `exited ${result.status}`}`)
  }
  throw new Error(`could not enqueue Backlog task: ${failures.join('; ')}`)
}

function parseLandPrsOptions(argv: ReadonlyArray<string>): LandPrsOptions {
  return {
    limit: numberFlag(argv, '--limit', 30),
    json: argv.includes('--json'),
    repo: stringFlag(argv, '--repo'),
  }
}

function parseDaemonOptions(argv: ReadonlyArray<string>): DaemonOptions {
  return {
    once: argv.includes('--once'),
    dryRun: argv.includes('--dry-run'),
    intervalSeconds: numberFlag(argv, '--interval', 60),
    limit: numberFlag(argv, '--limit', 30),
    stateFile: stringFlag(argv, '--state-file') ?? DEFAULT_DAEMON_STATE,
    repo: stringFlag(argv, '--repo'),
  }
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

function formatPacket(packet: PullRequestPacket): string {
  const reasons = packet.reasons.length > 0 ? packet.reasons.join('; ') : 'no blockers detected'
  return [
    `PR #${packet.number}: ${packet.title}`,
    `  ${packet.url}`,
    `  ${packet.author} ${packet.branch} -> ${packet.base}`,
    `  ${packet.changedFiles} files, +${packet.additions}/-${packet.deletions}`,
    `  reviews: ${packet.reviewDecision}; checks: ${packet.checkSummary}; merge: ${packet.mergeStateStatus}`,
    `  comments: ${packet.commentCount}; latest reviews: ${packet.reviewCount}`,
    `  recommendation: ${packet.recommendation}`,
    `  reasons: ${reasons}`,
  ].join('\n')
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

`)
}

function printPrDaemonHelp(): void {
  process.stdout.write(`
@oisincoveney/dev pr-daemon — Poll PR feedback and enqueue Backlog fix tasks

Usage:
  oisin-dev pr-daemon [--once] [--dry-run] [--interval 60] [--limit 30]
                      [--repo owner/name] [--state-file .agents/pr-daemon-state.json]

`)
}
