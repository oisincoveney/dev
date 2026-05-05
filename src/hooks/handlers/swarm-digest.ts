/**
 * Stop hook — emits a one-block digest of active swarm(s) for end-of-cycle
 * visibility. Silent if no active swarm or bd missing. Never blocks.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import type { HookDecision, HookHandler } from '../types.js'

function run(args: string[], cwd: string): string {
  const r = spawnSync('bd', args, { cwd, encoding: 'utf8' })
  return r.status === 0 ? (r.stdout ?? '') : ''
}

function bdOnPath(): boolean {
  return spawnSync('which', ['bd'], { encoding: 'utf8' }).status === 0
}

interface BdIssue {
  id?: string
  title?: string
  status?: string
  deps?: { discovered_from?: string }
  human?: boolean
}

interface BdSwarmList {
  swarms?: Array<{ id?: string; epic_id?: string; title?: string }>
}

export const swarmDigest: HookHandler = (input): HookDecision => {
  const cwd = input.cwd ?? process.cwd()

  if (!bdOnPath()) return { kind: 'allow' }
  if (!existsSync(join(cwd, '.beads'))) return { kind: 'allow' }

  let swarms: Array<{ id?: string; title?: string }>
  try {
    const swarmOut = run(['swarm', 'list', '--json'], cwd)
    const parsed = JSON.parse(swarmOut) as BdSwarmList | BdIssue[]
    swarms = Array.isArray(parsed)
      ? parsed.map((s) => ({ id: (s as BdIssue).id, title: (s as BdIssue).title }))
      : (parsed.swarms ?? []).map((s) => ({ id: s.epic_id, title: s.title }))
  } catch {
    try {
      const listOut = run(['list', '--type=epic', '--status=open', '--json'], cwd)
      const epics = JSON.parse(listOut) as BdIssue[]
      swarms = epics.map((e) => ({ id: e.id, title: e.title }))
    } catch {
      return { kind: 'allow' }
    }
  }

  if (swarms.length === 0) return { kind: 'allow' }

  const lines: string[] = []

  for (const swarm of swarms) {
    const epicId = swarm.id
    if (!epicId) continue

    let children: BdIssue[]
    try {
      const out = run(['list', `--parent=${epicId}`, '--json'], cwd)
      children = JSON.parse(out) as BdIssue[]
    } catch {
      continue
    }
    if (children.length === 0) continue

    const closed = children.filter((c) => c.status === 'closed').length
    const inProgress = children.filter((c) => c.status === 'in_progress').length
    const blocked = children.filter((c) => c.status === 'blocked').length
    const discovered = children.filter((c) => c.deps?.discovered_from).length
    const human = children.filter((c) => c.human === true).length

    // Skip fully-done swarms
    if (inProgress === 0 && blocked === 0 && closed === children.length && human === 0) continue

    lines.push(`\nSWARM DIGEST — ${epicId} · ${swarm.title ?? ''}`)
    lines.push(`  ${closed} closed  ·  ${inProgress} in_progress  ·  ${blocked} blocked  ·  total ${children.length}`)
    if (discovered > 0) lines.push(`  ${discovered} discovered-from filed`)
    if (human > 0) lines.push(`  ⚑ ${human} human-flagged — review with: bd human list`)
  }

  if (lines.length === 0) return { kind: 'allow' }

  return { kind: 'context', event: 'Stop', text: lines.join('\n') }
}
