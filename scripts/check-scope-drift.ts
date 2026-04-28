#!/usr/bin/env bun
/**
 * Post-session scope-drift detector.
 *
 * Parses .claude/audit.jsonl and reports any Edit/Write tool calls whose
 * file_path was outside the active bd issue's Files Likely Touched list,
 * without a corresponding discovered-from ticket having been filed.
 *
 * Usage:
 *   bun run scripts/check-scope-drift.ts
 *
 * Exit codes:
 *   0 — no scope violations, or no audit log to inspect.
 *   1 — violations found (printed to stdout).
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

interface AuditEntry {
  ts?: number
  sessionId?: string | null
  tool?: string | null
  input?: { file_path?: string; filePath?: string; command?: string } | null
}

interface BdIssue {
  id: string
  description?: string
  status?: string
}

const AUDIT_PATH = '.claude/audit.jsonl'
const SCOPE_SECTION_HEADER = '## Files Likely Touched'

function out(line: string): void {
  process.stdout.write(`${line}\n`)
}

const cwd = process.cwd()
const auditPath = join(cwd, AUDIT_PATH)

if (!existsSync(auditPath)) {
  out('No audit log at .claude/audit.jsonl — nothing to check.')
  process.exit(0)
}

const entries = parseAuditLog(readFileSync(auditPath, 'utf8'))
const editEvents = entries.filter((e) =>
  ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(e.tool ?? ''),
)

if (editEvents.length === 0) {
  out('No Edit/Write events in audit log.')
  process.exit(0)
}

const claimedIds = bdInProgressIds()
if (claimedIds.length === 0) {
  out('No in_progress claim — cannot check scope (audit predates the current claim).')
  process.exit(0)
}

const violations: Array<{ ticket: string; file: string; sessionId: string }> = []

for (const ticketId of claimedIds) {
  const filesInScope = parseFilesLikelyTouched(bdIssueDescription(ticketId))
  if (filesInScope === null) continue

  for (const event of editEvents) {
    const filePath = event.input?.file_path ?? event.input?.filePath
    if (!filePath) continue
    if (isPermittedAuxiliary(filePath)) continue
    if (matchesAnyPattern(filePath, filesInScope)) continue

    const hasDiscoveredFrom = bdDiscoveredFromExists(ticketId, filePath)
    if (hasDiscoveredFrom) continue

    violations.push({ ticket: ticketId, file: filePath, sessionId: event.sessionId ?? 'unknown' })
  }
}

if (violations.length === 0) {
  out(`Scope check OK — ${editEvents.length} Edit/Write events, all within claimed scope.`)
  process.exit(0)
}

out(`Scope drift detected — ${violations.length} edit(s) outside the claimed ticket's Files Likely Touched without a discovered-from ticket:\n`)
for (const v of violations) {
  out(`  - ${v.ticket}: ${v.file} (session ${v.sessionId})`)
}
out('\nFile a discovered-from ticket via `bd create --deps=discovered-from:<id>` for each, or document the rationale.')
process.exit(1)

function parseAuditLog(text: string): AuditEntry[] {
  const result: AuditEntry[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try {
      result.push(JSON.parse(line) as AuditEntry)
    } catch {
      // Skip malformed lines silently — audit log is best-effort.
    }
  }
  return result
}

function bdInProgressIds(): string[] {
  try {
    const stdout = execFileSync('bd', ['list', '--status', 'in_progress', '--json'], {
      cwd,
      encoding: 'utf8',
    })
    const issues = JSON.parse(stdout) as BdIssue[]
    return issues.map((i) => i.id)
  } catch {
    return []
  }
}

function bdIssueDescription(id: string): string {
  try {
    const stdout = execFileSync('bd', ['show', id, '--json'], { cwd, encoding: 'utf8' })
    const arr = JSON.parse(stdout) as BdIssue[]
    return arr[0]?.description ?? ''
  } catch {
    return ''
  }
}

function parseFilesLikelyTouched(description: string): string[] | null {
  const idx = description.indexOf(SCOPE_SECTION_HEADER)
  if (idx === -1) return null
  const after = description.slice(idx + SCOPE_SECTION_HEADER.length)
  const nextSectionIdx = after.search(/\n## /)
  const block = nextSectionIdx === -1 ? after : after.slice(0, nextSectionIdx)
  const lines = block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
  return lines.map((line) => line.slice(2).split(/\s—\s|\s--\s/)[0].trim()).filter((x) => x.length > 0)
}

function isPermittedAuxiliary(filePath: string): boolean {
  if (filePath.endsWith('.test.ts') || filePath.endsWith('.test.tsx')) return true
  if (filePath.endsWith('.spec.ts') || filePath.endsWith('.spec.tsx')) return true
  if (filePath.endsWith('_test.go')) return true
  if (filePath.includes('/__tests__/') || filePath.includes('/tests/')) return true
  if (
    filePath.endsWith('.gitignore') ||
    filePath.endsWith('package.json') ||
    filePath.endsWith('CHANGELOG.md') ||
    filePath.endsWith('README.md')
  ) {
    return true
  }
  return false
}

function matchesAnyPattern(filePath: string, patterns: string[]): boolean {
  const normalized = filePath.startsWith('/') ? filePath.slice(filePath.indexOf(cwd) + cwd.length + 1) : filePath
  for (const pattern of patterns) {
    if (normalized === pattern) return true
    if (normalized.includes(pattern)) return true
    if (pattern.endsWith('/') && normalized.startsWith(pattern)) return true
  }
  return false
}

function bdDiscoveredFromExists(parentId: string, filePathHint: string): boolean {
  try {
    const stdout = execFileSync('bd', ['list', '--status', 'all', '--json'], {
      cwd,
      encoding: 'utf8',
    })
    const issues = JSON.parse(stdout) as BdIssue[]
    for (const issue of issues) {
      const desc = issue.description ?? ''
      if (
        desc.includes(`discovered-from:${parentId}`) ||
        (desc.includes(parentId) && desc.includes(filePathHint))
      ) {
        return true
      }
    }
    return false
  } catch {
    return false
  }
}
