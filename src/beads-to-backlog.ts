import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface BeadsDependency {
  issue_id?: string
  depends_on_id?: string
  type?: string
}

export interface BeadsImportIssue {
  id: string
  title: string
  description?: string
  notes?: string
  status?: string
  priority?: number | string
  issue_type?: string
  type?: string
  assignee?: string
  labels?: string[]
  dependencies?: BeadsDependency[]
  external_ref?: string
  created_at?: string
  updated_at?: string
  started_at?: string
  closed_at?: string
  close_reason?: string
  _type?: string
}

export interface BacklogImportReport {
  imported: number
  skipped: number
  source: 'issues.jsonl' | 'bd'
}

function priorityLabel(value: number | string | undefined): 'high' | 'medium' | 'low' {
  const raw = typeof value === 'string' ? Number.parseInt(value.replace(/^P/i, ''), 10) : value
  if (raw === 0 || raw === 1) return 'high'
  if (raw === 2 || raw === undefined || Number.isNaN(raw)) return 'medium'
  return 'low'
}

function statusLabel(status: string | undefined): string {
  switch (status) {
    case 'closed':
      return 'Done'
    case 'in_progress':
    case 'hooked':
      return 'In Progress'
    default:
      return 'To Do'
  }
}

function sanitizeLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '')
}

function yamlString(value: string): string {
  return JSON.stringify(value)
}

function dateString(value: string | undefined): string | null {
  if (value === undefined || value.length === 0) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().replace('T', ' ').slice(0, 16)
}

function slug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\w\s.-]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80) || 'task'
}

function taskFileName(issue: BeadsImportIssue): string {
  return `${issue.id} - ${slug(issue.title)}.md`
}

function issueDependencies(issue: BeadsImportIssue): string[] {
  const deps = issue.dependencies ?? []
  return [...new Set(deps
    .filter((dep) => dep.type === 'blocks' && dep.depends_on_id !== undefined)
    .map((dep) => dep.depends_on_id as string))]
}

function relationNotes(issue: BeadsImportIssue): string[] {
  const deps = issue.dependencies ?? []
  return deps
    .filter((dep) => dep.depends_on_id !== undefined && dep.type !== 'blocks')
    .map((dep) => `- ${dep.type ?? 'related'}: ${dep.depends_on_id}`)
}

function labels(issue: BeadsImportIssue): string[] {
  const out = new Set<string>(['beads'])
  const type = issue.issue_type ?? issue.type
  if (type !== undefined) out.add(`beads-type:${sanitizeLabel(type)}`)
  if (issue.status !== undefined && !['open', 'closed', 'in_progress'].includes(issue.status)) {
    out.add(`beads-status:${sanitizeLabel(issue.status)}`)
  }
  if (issue.priority !== undefined) out.add(`beads-priority:P${String(issue.priority).replace(/^P/i, '')}`)
  for (const label of issue.labels ?? []) out.add(sanitizeLabel(label))
  return [...out].filter((entry) => entry.length > 0).sort()
}

export function renderBacklogTask(issue: BeadsImportIssue): string {
  const deps = issueDependencies(issue)
  const created = dateString(issue.created_at)
  const updated = dateString(issue.updated_at)
  const refs = issue.external_ref !== undefined ? [issue.external_ref] : []
  const assignee = issue.assignee !== undefined && issue.assignee.length > 0 ? [issue.assignee] : []
  const metaNotes = [
    `Imported from Beads issue ${issue.id}.`,
    issue.started_at ? `Started at: ${issue.started_at}` : null,
    issue.closed_at ? `Closed at: ${issue.closed_at}` : null,
    ...relationNotes(issue),
  ].filter((entry): entry is string => entry !== null)
  const notes = [issue.notes, metaNotes.join('\n')].filter((entry) => entry !== undefined && entry.length > 0).join('\n\n')
  const finalSummary = issue.close_reason !== undefined && issue.close_reason.length > 0
    ? `Beads close reason: ${issue.close_reason}`
    : ''
  const finalSection = finalSummary.length === 0 ? '' : `
## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
${finalSummary}
<!-- SECTION:FINAL_SUMMARY:END -->
`

  const frontmatter = [
    '---',
    `id: ${yamlString(issue.id)}`,
    `title: ${yamlString(issue.title)}`,
    `status: ${yamlString(statusLabel(issue.status))}`,
    `assignee: ${JSON.stringify(assignee)}`,
    created === null ? null : `created_date: ${yamlString(created)}`,
    updated === null ? null : `updated_date: ${yamlString(updated)}`,
    `labels: ${JSON.stringify(labels(issue))}`,
    `dependencies: ${JSON.stringify(deps)}`,
    refs.length === 0 ? null : `references: ${JSON.stringify(refs)}`,
    `priority: ${priorityLabel(issue.priority)}`,
    '---',
  ].filter((entry): entry is string => entry !== null)

  return `${frontmatter.join('\n')}

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
${issue.description ?? ''}
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
${notes}
<!-- SECTION:NOTES:END -->
${finalSection}`
}

function readIssuesJsonl(cwd: string): BeadsImportIssue[] | null {
  const path = join(cwd, '.beads', 'issues.jsonl')
  if (!existsSync(path)) return null
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as BeadsImportIssue)
    .filter((issue) => issue._type !== 'memory' && typeof issue.id === 'string' && typeof issue.title === 'string')
}

function readIssuesFromBd(cwd: string): BeadsImportIssue[] {
  const result = spawnSync('bd', ['list', '--all', '--limit', '0', '--json', '--readonly'], {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
  })
  if (result.error !== undefined) throw new Error(`bd failed to start: ${result.error.message}`)
  if (result.status !== 0) throw new Error(result.stderr.trim() || 'bd list failed')
  const parsed = JSON.parse(result.stdout) as BeadsImportIssue[]
  return parsed.filter((issue) => typeof issue.id === 'string' && typeof issue.title === 'string')
}

export function importBeadsToBacklog(cwd: string): BacklogImportReport {
  const jsonlIssues = readIssuesJsonl(cwd)
  const source = jsonlIssues === null ? 'bd' : 'issues.jsonl'
  const issues = jsonlIssues ?? readIssuesFromBd(cwd)
  const tasksDir = join(cwd, 'backlog', 'tasks')
  mkdirSync(tasksDir, { recursive: true })
  let skipped = 0
  for (const issue of issues) {
    if (issue._type === 'memory') {
      skipped += 1
      continue
    }
    writeFileSync(join(tasksDir, taskFileName(issue)), renderBacklogTask(issue))
  }
  return { imported: issues.length - skipped, skipped, source }
}

export function runBeadsToBacklog(argv: ReadonlyArray<string> = process.argv.slice(3)): void {
  const cwd = process.cwd()
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write('Usage: oisin-dev beads-to-backlog\n\nImports existing .beads tickets into Backlog.md task files.\n')
    return
  }
  const report = importBeadsToBacklog(cwd)
  process.stdout.write(`Imported ${report.imported} Beads issue(s) into Backlog.md from ${report.source}.\n`)
}
