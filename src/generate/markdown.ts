/**
 * Generates the CLAUDE.md / AGENTS.md kernel.
 *
 * The kernel stays small (~30 lines) because `.claude/rules/*.md` carries the
 * real content and Claude Code auto-loads rules either always (no `paths:`) or
 * when matching files are read (with `paths:`). Inlining fragments via `@import`
 * would re-bloat the baseline.
 */

import type { DevConfig } from '../config.js'
import type { Answers } from '../prompts.js'

export interface ClaudeMdBundle {
  root: string
  fragments: Record<string, string>
}

/** Entry point for install.ts. Returns the kernel (no fragments). */
export function buildClaudeMdBundle(config: DevConfig, _answers: Answers): ClaudeMdBundle {
  return { root: buildClaudeKernel(config), fragments: {} }
}

/** Back-compat: flat markdown for callers that want a single string. */
export function generateClaudeMd(config: DevConfig, answers: Answers): string {
  return buildClaudeMdBundle(config, answers).root
}

export function buildClaudeKernel(config: DevConfig): string {
  const lines = [
    '# Project Instructions for AI Agents',
    '',
    'Configured with @oisincoveney/dev. Hooks enforce most rules mechanically. Detailed rules in `.claude/rules/` — Claude Code auto-loads (always for unscoped, on matching file read for path-scoped).',
    '',
    '## Critical Rules (always active)',
    '',
  ]

  const criticalBullets: string[] = []

  if (config.tools.includes('beads')) {
    criticalBullets.push('Use `bd` for ALL task tracking — TodoWrite blocked by hook.')
    criticalBullets.push('Before ticket work, run `bd dolt pull`; after ticket changes, run `bd dolt push`.')
    criticalBullets.push('Do not commit `.beads/issues.jsonl`; shared ticket state lives in repo-backed Dolt refs.')
  }
  criticalBullets.push('Never run destructive commands without explicit user approval — blocked by hook.')
  criticalBullets.push('Read before editing; verify before claiming done.')
  criticalBullets.push(
    'Confident wrong > honest uncertain — false. Say "I need to verify", check.',
  )
  criticalBullets.push('User constraints non-negotiable. Don\'t reinterpret.')
  criticalBullets.push('No follow-up questions like "Want me to...". Done → stop.')
  criticalBullets.push(
    'Don\'t write "this works"/"should work"/"done" without running test cmd + seeing pass. Stop hook enforces.',
  )
  criticalBullets.push(
    'One non-trivial question at a time. Stacking judgment-call questions = not OK.',
  )

  for (const b of criticalBullets) lines.push(`- ${b}`)
  lines.push('')
  lines.push('## Detailed Rules')
  lines.push('')
  lines.push(
    'See `.claude/rules/` for full set. Topic files (`architecture.md`, `testing.md`, `ai-behavior.md`, etc.) load every session. Path-scoped (`component-patterns.md`, `styling-ui.md`, `contract-driven.md`) load only on matching file read — editing `.tsx` pulls frontend rules automatically.',
  )
  lines.push('')

  return lines.join('\n')
}
