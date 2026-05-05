/**
 * PreCompact hook — re-primes harness-specific context after /compact.
 *
 * After a /compact the model loses session context injected at SessionStart.
 * This hook re-injects the minimal reminder (caveman mode + project info)
 * so behaviour stays consistent across compact boundaries.
 *
 * Migrated from templates/hooks/pre-compact-prime.sh.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HookDecision, HookHandler, HookInput } from '../types.js'

const COMPACT_PREAMBLE =
  'Context restored after /compact. Caveman mode persists from session start (off only with: stop caveman / normal mode).'

interface DevConfig {
  language?: string
  variant?: string
  workflow?: string
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T
  } catch {
    return null
  }
}

function buildContextText(input: HookInput): string {
  const cwd = input.cwd ?? process.cwd()
  const config = readJson<DevConfig>(join(cwd, '.dev.config.json'))

  let context = COMPACT_PREAMBLE

  if (config) {
    const projectLine = `Project: ${config.variant ?? ''} (${config.language ?? ''}) | workflow: ${config.workflow ?? ''}`
    context = `${context}\n${projectLine}`
  }

  return context
}

export const preCompactPrime: HookHandler = (input): HookDecision => {
  const text = buildContextText(input)
  return { kind: 'context', event: 'PreCompact', text }
}
