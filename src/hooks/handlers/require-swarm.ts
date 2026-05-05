/**
 * PreToolUse hook for Write|Edit — denies source-file edits when the claimed
 * bd issue's parent epic has no registered swarm.
 */

import { spawnSync } from 'node:child_process'
import { extname } from 'node:path'
import type { HookDecision, HookHandler } from '../types.js'

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.rs', '.go', '.swift', '.py', '.rb',
])

const BYPASS_PATTERNS = [
  /\.(test|spec)\.[a-z]+$/,
  /_test\.go$/,
  /[/\\](tests|__tests__)[/\\]/,
  /[/\\](node_modules|dist|build|target|\.next|generated)[/\\]/,
  /[/\\]\.(claude|beads|cursor|codex|opencode|git|github)[/\\]/,
  /\.(md|json|ya?ml|toml)$/i,
]

function isSourceFile(filePath: string): boolean {
  if (BYPASS_PATTERNS.some((p) => p.test(filePath))) return false
  return SOURCE_EXTENSIONS.has(extname(filePath).toLowerCase())
}

function run(cmd: string, args: string[], cwd: string): { stdout: string; ok: boolean } {
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8' })
  return { stdout: result.stdout ?? '', ok: result.status === 0 && !result.error }
}

function bdOnPath(): boolean {
  const r = spawnSync('which', ['bd'], { encoding: 'utf8' })
  return r.status === 0
}

export const requireSwarm: HookHandler = (input): HookDecision => {
  const filePath = input.tool_input?.file_path ?? input.tool_input?.filePath
  if (typeof filePath !== 'string' || filePath.length === 0) return { kind: 'allow' }
  if (!isSourceFile(filePath)) return { kind: 'allow' }
  if (!bdOnPath()) return { kind: 'allow' }

  const cwd = input.cwd ?? process.cwd()

  // Get first in_progress claim
  const { stdout: listOut, ok: listOk } = run('bd', ['list', '--status', 'in_progress', '--json'], cwd)
  if (!listOk) return { kind: 'allow' }

  let claimedId: string | undefined
  try {
    const items = JSON.parse(listOut) as Array<{ id?: string }>
    claimedId = items[0]?.id
  } catch {
    return { kind: 'allow' }
  }
  if (!claimedId) return { kind: 'allow' }

  // Get parent epic ID from bd show output
  const { stdout: showOut, ok: showOk } = run('bd', ['show', claimedId], cwd)
  if (!showOk) return { kind: 'allow' }

  // Look for parent epic line: usually contains EPIC or ↑
  const parentMatch = showOut.match(/PARENT[\s\S]*?([a-z][a-z0-9-]+-[a-z0-9]+)/m)
  const epicIdMatch = showOut.match(/\(EPIC\).*?([a-z][a-z0-9-]+-[a-z0-9]+)/m)
  const parentEpicId = epicIdMatch?.[1] ?? parentMatch?.[1]
  if (!parentEpicId) return { kind: 'allow' }

  // Check if swarm is registered
  const { stdout: swarmOut, ok: swarmOk } = run('bd', ['swarm', 'list', '--json'], cwd)
  if (!swarmOk) return { kind: 'allow' }

  try {
    const swarms = JSON.parse(swarmOut) as { swarms?: Array<{ epic_id?: string }> }
    const registered = (swarms.swarms ?? []).some((s) => s.epic_id === parentEpicId)
    if (registered) return { kind: 'allow' }
  } catch {
    return { kind: 'allow' }
  }

  return {
    kind: 'block',
    reason: [
      '⛔ No swarm registered for the parent epic of your claimed ticket.',
      '',
      `   Claimed: ${claimedId}`,
      `   Parent epic: ${parentEpicId}`,
      '',
      '   Multi-ticket epics need a registered swarm before source edits.',
      `   Run:  bd swarm create ${parentEpicId}`,
      '',
      '   Then retry the edit.',
    ].join('\n'),
  }
}
