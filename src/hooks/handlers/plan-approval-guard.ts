/**
 * PreToolUse hook for Bash — gates `bd create --graph --parent=<id>` and
 * `bd swarm create <id>` on the parent epic having user approval recorded in
 * bd memories.
 *
 * Fail-open on subprocess errors, missing bd, missing .beads/, or any
 * unexpected parsing failure.
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { HookDecision, HookHandler } from '../types.js'

interface BdEpic {
  id?: string
  description?: string
  body?: string
  human?: boolean
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function bdOnPath(): boolean {
  const result = spawnSync('command', ['-v', 'bd'], {
    encoding: 'utf8',
    shell: true,
  })
  return result.status === 0 && !result.error
}

function runBd(args: string[], cwd: string): { stdout: string; ok: boolean } {
  const result = spawnSync('bd', args, { cwd, encoding: 'utf8' })
  if (result.error || result.status !== 0) return { stdout: '', ok: false }
  return { stdout: result.stdout ?? '', ok: true }
}

function extractEpicId(command: string): string | null {
  // `bd create --graph ... --parent=<id>`
  const parentMatch = command.match(/--parent=([^\s]+)/)
  if (parentMatch) return parentMatch[1]

  // `bd swarm create <id>`
  const swarmMatch = command.match(/bd\s+swarm\s+create\s+([^\s]+)/)
  if (swarmMatch) return swarmMatch[1]

  return null
}

function parseBdJson(stdout: string): BdEpic | null {
  try {
    const parsed = JSON.parse(stdout) as unknown
    if (Array.isArray(parsed)) return (parsed[0] as BdEpic) ?? null
    return parsed as BdEpic
  } catch {
    return null
  }
}

export const planApprovalGuard: HookHandler = async (
  input,
): Promise<HookDecision> => {
  const command = input.tool_input?.command
  if (typeof command !== 'string' || command.length === 0) {
    return { kind: 'allow' }
  }

  const epicId = extractEpicId(command)
  if (!epicId) return { kind: 'allow' }

  if (!bdOnPath()) return { kind: 'allow' }

  const cwd = input.cwd ?? process.cwd()
  if (!existsSync(join(cwd, '.beads'))) return { kind: 'allow' }

  const showResult = runBd(['show', epicId, '--json'], cwd)
  if (!showResult.ok) return { kind: 'allow' }

  const epic = parseBdJson(showResult.stdout)
  if (!epic) return { kind: 'allow' }

  // If the `human` flag is set the plan is pending review — block immediately.
  if (epic.human === true) {
    return {
      kind: 'block',
      reason: [
        `⛔ Epic ${epicId} has plan-review pending (human flag set).`,
        '   Ask the user to run /approve or /reject before proceeding.',
      ].join('\n'),
    }
  }

  const descriptionText = epic.description ?? epic.body ?? ''
  const hash = sha256(descriptionText)

  const exactKey = `plan-approved:${epicId}:${hash}`
  const exactCheck = runBd(['memories', exactKey], cwd)
  if (exactCheck.ok && exactCheck.stdout.includes(exactKey)) {
    return { kind: 'allow' }
  }

  // Check if any approval exists for this epic (body may have changed).
  const prefixKey = `plan-approved:${epicId}:`
  const anyApproval = runBd(['memories', prefixKey], cwd)
  const hasAnyApproval = anyApproval.ok && anyApproval.stdout.includes(prefixKey)

  if (hasAnyApproval) {
    return {
      kind: 'block',
      reason: [
        `⛔ Epic ${epicId} was approved, but the description has changed since then.`,
        '   Ask the user to re-run /approve to re-approve the updated plan.',
      ].join('\n'),
    }
  }

  return {
    kind: 'block',
    reason: [
      `⛔ Epic ${epicId} has not been approved by the user.`,
      '   Ask the user to review the plan and run /approve before spawning tasks.',
    ].join('\n'),
  }
}
