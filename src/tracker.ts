import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

export const WORKFLOW_SCHEMA_VERSION = 1

export type TrackerPriority = 0 | 1 | 2 | 3 | 4
export type TrackerKind = 'quick' | 'task' | 'plan' | 'child'
export type TrackerState = 'draft' | 'review' | 'ready' | 'in_progress' | 'blocked' | 'closed'

export interface WorkflowPlan {
  summary: string
  priority_rationale: string
  files: string[]
  acceptance: string[]
  verify: string[]
  graph: unknown | null
  pr_groups: unknown[]
}

export interface WorkflowApproval {
  hash: string | null
  approved_at: string | null
  approved_by: string | null
}

export interface WorkflowRuntime {
  branch: string | null
  worktree: string | null
  agent: string | null
  commits: string[]
  prs: string[]
}

export interface WorkflowMetadata {
  schema: 1
  kind: TrackerKind
  state: TrackerState
  plan: WorkflowPlan
  approval: WorkflowApproval
  runtime: WorkflowRuntime
}

export interface BeadsIssue {
  id: string
  title: string
  description?: string
  status: string
  priority: number | string
  issue_type?: string
  type?: string
  metadata?: Record<string, unknown>
}

export interface NormalizedTrackerItem {
  id: string
  title: string
  description: string
  status: string
  priority: TrackerPriority
  type: string
  workflow: WorkflowMetadata
}

const TRACKER_STATES = new Set<TrackerState>([
  'draft',
  'review',
  'ready',
  'in_progress',
  'blocked',
  'closed',
])

const TRACKER_KINDS = new Set<TrackerKind>(['quick', 'task', 'plan', 'child'])

export function defaultWorkflowMetadata(kind: TrackerKind = 'task', state: TrackerState = 'review'): WorkflowMetadata {
  return {
    schema: WORKFLOW_SCHEMA_VERSION,
    kind,
    state,
    plan: {
      summary: '',
      priority_rationale: '',
      files: [],
      acceptance: [],
      verify: [],
      graph: null,
      pr_groups: [],
    },
    approval: {
      hash: null,
      approved_at: null,
      approved_by: null,
    },
    runtime: {
      branch: null,
      worktree: null,
      agent: null,
      commits: [],
      prs: [],
    },
  }
}

export function parsePriority(value: number | string): TrackerPriority {
  const raw = typeof value === 'string' ? value.replace(/^P/i, '') : String(value)
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 4) {
    throw new Error(`Invalid tracker priority: ${String(value)}`)
  }
  return parsed as TrackerPriority
}

export function stateFromBeadsStatus(status: string): TrackerState {
  if (status === 'in_progress') return 'in_progress'
  if (status === 'blocked') return 'blocked'
  if (status === 'closed') return 'closed'
  return 'review'
}

function asStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`metadata.workflow.${field} must be an array of strings`)
  }
  return value
}

function asUnknownArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`metadata.workflow.${field} must be an array`)
  }
  return value
}

function asNullableString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new Error(`metadata.workflow.${field} must be a string or null`)
  return value
}

function asObject(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`metadata.workflow.${field} must be an object`)
  }
  return value as Record<string, unknown>
}

export function parseWorkflowMetadata(value: unknown): WorkflowMetadata {
  const workflow = asObject(value, '')
  if (workflow.schema !== WORKFLOW_SCHEMA_VERSION) {
    throw new Error(`metadata.workflow.schema must be ${WORKFLOW_SCHEMA_VERSION}`)
  }

  if (typeof workflow.kind !== 'string' || !TRACKER_KINDS.has(workflow.kind as TrackerKind)) {
    throw new Error('metadata.workflow.kind is invalid')
  }
  if (typeof workflow.state !== 'string' || !TRACKER_STATES.has(workflow.state as TrackerState)) {
    throw new Error('metadata.workflow.state is invalid')
  }

  const plan = asObject(workflow.plan, 'plan')
  const approval = asObject(workflow.approval, 'approval')
  const runtime = asObject(workflow.runtime, 'runtime')

  return {
    schema: WORKFLOW_SCHEMA_VERSION,
    kind: workflow.kind as TrackerKind,
    state: workflow.state as TrackerState,
    plan: {
      summary: typeof plan.summary === 'string' ? plan.summary : '',
      priority_rationale: typeof plan.priority_rationale === 'string' ? plan.priority_rationale : '',
      files: asStringArray(plan.files ?? [], 'plan.files'),
      acceptance: asStringArray(plan.acceptance ?? [], 'plan.acceptance'),
      verify: asStringArray(plan.verify ?? [], 'plan.verify'),
      graph: plan.graph ?? null,
      pr_groups: asUnknownArray(plan.pr_groups ?? [], 'plan.pr_groups'),
    },
    approval: {
      hash: asNullableString(approval.hash, 'approval.hash'),
      approved_at: asNullableString(approval.approved_at, 'approval.approved_at'),
      approved_by: asNullableString(approval.approved_by, 'approval.approved_by'),
    },
    runtime: {
      branch: asNullableString(runtime.branch, 'runtime.branch'),
      worktree: asNullableString(runtime.worktree, 'runtime.worktree'),
      agent: asNullableString(runtime.agent, 'runtime.agent'),
      commits: asStringArray(runtime.commits ?? [], 'runtime.commits'),
      prs: asStringArray(runtime.prs ?? [], 'runtime.prs'),
    },
  }
}

export function workflowFromBeadsIssue(issue: BeadsIssue): WorkflowMetadata {
  const workflow = issue.metadata?.workflow
  if (workflow !== undefined) return parseWorkflowMetadata(workflow)
  return defaultWorkflowMetadata(issue.issue_type === 'epic' ? 'plan' : 'task', stateFromBeadsStatus(issue.status))
}

export function normalizeBeadsIssue(issue: BeadsIssue): NormalizedTrackerItem {
  return {
    id: issue.id,
    title: issue.title,
    description: issue.description ?? '',
    status: issue.status,
    priority: parsePriority(issue.priority),
    type: issue.issue_type ?? issue.type ?? 'task',
    workflow: workflowFromBeadsIssue(issue),
  }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`
}

export function approvalHashInput(item: NormalizedTrackerItem): unknown {
  return {
    title: item.title,
    description: item.description,
    priority: item.priority,
    type: item.type,
    plan: item.workflow.plan,
  }
}

export function computeApprovalHash(item: NormalizedTrackerItem): string {
  return createHash('sha256').update(stableJson(approvalHashInput(item))).digest('hex')
}

function readStdin(): string {
  return readFileSync(0, 'utf8')
}

function printTrackerHelp(): void {
  process.stdout.write(`
@oisincoveney/dev tracker — normalized tracker shim

Usage:
  oisin-dev tracker show <id>
  oisin-dev tracker validate-json [file|-]
  oisin-dev tracker hash-json [file|-]
  oisin-dev tracker approve <id>

The first adapter is beads. Workflow data lives in metadata.workflow JSON.

`)
}

function runBd(args: string[]): string {
  const result = spawnSync('bd', args, { encoding: 'utf8' })
  if (result.error !== undefined) throw new Error(`bd failed to start: ${result.error.message}`)
  if (result.status !== 0) throw new Error(result.stderr.trim() || `bd ${args.join(' ')} failed`)
  return result.stdout
}

function readJsonArg(arg: string | undefined): unknown {
  if (arg === undefined || arg === '-') return JSON.parse(readStdin()) as unknown
  return JSON.parse(readFileSync(arg, 'utf8')) as unknown
}

function showBeadsIssue(id: string): BeadsIssue {
  const raw = runBd(['show', id, '--long', '--json'])
  const parsed = JSON.parse(raw) as unknown
  if (Array.isArray(parsed)) {
    if (parsed.length !== 1) throw new Error(`Expected one issue for ${id}, got ${parsed.length}`)
    return parsed[0] as BeadsIssue
  }
  return parsed as BeadsIssue
}

function setBeadsWorkflow(id: string, issue: BeadsIssue, workflow: WorkflowMetadata): void {
  const metadata = { ...(issue.metadata ?? {}), workflow }
  runBd(['update', id, '--metadata', JSON.stringify(metadata)])
}

export function runTracker(argv: ReadonlyArray<string>): void {
  const command = argv[0]
  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    printTrackerHelp()
    return
  }

  if (command === 'validate-json') {
    parseWorkflowMetadata(readJsonArg(argv[1]))
    process.stdout.write('ok\n')
    return
  }

  if (command === 'hash-json') {
    const item = readJsonArg(argv[1]) as NormalizedTrackerItem
    process.stdout.write(`${computeApprovalHash(item)}\n`)
    return
  }

  if (command === 'show') {
    const id = argv[1]
    if (id === undefined) throw new Error('Usage: oisin-dev tracker show <id>')
    process.stdout.write(`${JSON.stringify(normalizeBeadsIssue(showBeadsIssue(id)), null, 2)}\n`)
    return
  }

  if (command === 'approve') {
    const id = argv[1]
    if (id === undefined) throw new Error('Usage: oisin-dev tracker approve <id>')
    const issue = showBeadsIssue(id)
    const item = normalizeBeadsIssue(issue)
    const workflow = item.workflow
    workflow.approval = {
      hash: computeApprovalHash(item),
      approved_at: new Date().toISOString(),
      approved_by: process.env.USER ?? null,
    }
    workflow.state = 'ready'
    setBeadsWorkflow(id, issue, workflow)
    process.stdout.write(`${workflow.approval.hash}\n`)
    return
  }

  throw new Error(`Unknown tracker command: ${command}`)
}
