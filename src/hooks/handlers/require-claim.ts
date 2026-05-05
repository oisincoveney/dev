/**
 * PreToolUse hook for Write/Edit — blocks edits to source files unless a
 * bd issue is currently in_progress (claimed).
 *
 * Fail-open when bd is not on PATH or on any subprocess error.
 */

import { spawnSync } from 'node:child_process'
import { extname } from 'node:path'
import type { HookDecision, HookHandler } from '../types.js'

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.rs', '.go', '.swift', '.py', '.rb',
])

const BYPASS_DIR_PATTERNS: RegExp[] = [
  /[/\\]\.claude[/\\]/,
  /[/\\]\.beads[/\\]/,
  /[/\\]\.cursor[/\\]/,
  /[/\\]\.codex[/\\]/,
  /[/\\]\.opencode[/\\]/,
  /[/\\]\.git[/\\]/,
  /[/\\]node_modules[/\\]/,
  /[/\\]dist[/\\]/,
  /[/\\]build[/\\]/,
  /[/\\]target[/\\]/,
  /[/\\]\.next[/\\]/,
  /[/\\]generated[/\\]/,
]

const BYPASS_EXTENSION_PATTERN = /\.(md|json|ya?ml|toml)$/i

const TEST_FILE_PATTERN = /\.(test|spec)\.[a-z]+$|__tests__/i

const BLOCK_REASON = `\
⛔ No claimed bd issue. Edits to source files require an in_progress claim.

   bd ready                    — find available work
   bd update <id> --claim      — claim an issue

Run one of the above, then retry the edit.`

function isSourceFile(filePath: string): boolean {
  if (BYPASS_EXTENSION_PATTERN.test(filePath)) return false
  if (TEST_FILE_PATTERN.test(filePath)) return false
  if (BYPASS_DIR_PATTERNS.some((p) => p.test(filePath))) return false
  return SOURCE_EXTENSIONS.has(extname(filePath).toLowerCase())
}

function bdOnPath(): boolean {
  const result = spawnSync('command', ['-v', 'bd'], {
    encoding: 'utf8',
    shell: true,
  })
  return result.status === 0 && !result.error
}

function inProgressCount(cwd: string): number {
  const result = spawnSync(
    'bd',
    ['list', '--status', 'in_progress', '--json'],
    { cwd, encoding: 'utf8' },
  )
  if (result.status !== 0 || result.error) return 0
  try {
    const parsed = JSON.parse(result.stdout) as unknown[]
    return Array.isArray(parsed) ? parsed.length : 0
  } catch {
    return 0
  }
}

export const requireClaim: HookHandler = (input): HookDecision => {
  const filePath = input.tool_input?.file_path ?? input.tool_input?.filePath
  if (typeof filePath !== 'string' || filePath.length === 0) {
    return { kind: 'allow' }
  }

  if (!isSourceFile(filePath)) return { kind: 'allow' }

  if (!bdOnPath()) return { kind: 'allow' }

  const cwd = input.cwd ?? process.cwd()
  const count = inProgressCount(cwd)
  if (count > 0) return { kind: 'allow' }

  return { kind: 'block', reason: BLOCK_REASON }
}
