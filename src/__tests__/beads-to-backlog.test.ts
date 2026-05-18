import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { importBeadsToBacklog, renderBacklogTask } from '../beads-to-backlog.js'

describe('beads-to-backlog import', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'beads-import-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('renders a Beads issue as a Backlog task while preserving the original id', () => {
    const rendered = renderBacklogTask({
      id: 'tova-5bnq.3',
      title: 'Add bank authorization return E2E smoke',
      description: '## Acceptance Criteria\n- Existing markdown stays readable.',
      notes: 'Verifier notes.',
      status: 'closed',
      priority: 1,
      issue_type: 'bug',
      assignee: 'oisin-bot',
      dependencies: [
        { issue_id: 'tova-5bnq.3', depends_on_id: 'tova-parent', type: 'parent-child' },
        { issue_id: 'tova-5bnq.3', depends_on_id: 'tova-blocker', type: 'blocks' },
      ],
      external_ref: 'https://github.com/oisin-ee/tova/pull/169',
      created_at: '2026-05-13T00:09:39Z',
      updated_at: '2026-05-13T00:10:17Z',
      closed_at: '2026-05-13T01:00:00Z',
      close_reason: 'verified',
    })

    expect(rendered).toContain('id: "tova-5bnq.3"')
    expect(rendered).toContain('status: "Done"')
    expect(rendered).toContain('priority: high')
    expect(rendered).toContain('"beads-type:bug"')
    expect(rendered).toContain('"tova-blocker"')
    expect(rendered).toContain('parent-child: tova-parent')
    expect(rendered).toContain('Beads close reason: verified')
  })

  it('imports issues.jsonl records and skips Beads memory records', () => {
    const beads = join(dir, '.beads')
    writeFileSync(join(dir, 'placeholder'), '')
    mkdirSync(beads, { recursive: true })
    writeFileSync(
      join(beads, 'issues.jsonl'),
      [
        JSON.stringify({ id: 'repo-a1', title: 'Open task', status: 'open', priority: 2, issue_type: 'task' }),
        JSON.stringify({ _type: 'memory', key: 'x', value: 'ignored' }),
        JSON.stringify({ id: 'repo-b2', title: 'Pinned decision', status: 'pinned', priority: 0, issue_type: 'decision' }),
      ].join('\n'),
    )

    const report = importBeadsToBacklog(dir)

    expect(report).toEqual({ imported: 2, skipped: 0, source: 'issues.jsonl' })
    expect(existsSync(join(dir, 'backlog', 'tasks', 'repo-a1 - Open-task.md'))).toBe(true)
    const pinned = readFileSync(join(dir, 'backlog', 'tasks', 'repo-b2 - Pinned-decision.md'), 'utf8')
    expect(pinned).toContain('"beads-status:pinned"')
    expect(pinned).toContain('"beads-type:decision"')
  })
})
