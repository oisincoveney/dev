/**
 * SessionStart hook — injects per-session static context into the model.
 *
 * Reads .dev.config.json for project info (language, variant, workflow,
 * commands) and the relevant package manifest for installed dependencies.
 * Always returns a `context` decision so the model has the harness rules
 * and caveman communication style from the very first turn.
 *
 * Migrated from templates/hooks/context-bootstrap.sh.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HookDecision, HookHandler, HookInput } from '../types.js'

const CAVEMAN_MODE_TEXT = `COMMUNICATION MODE — caveman (full). Active every response this session unless user says "stop caveman" or "normal mode".

Drop: articles (a/an/the), filler (just/really/basically/actually/simply), pleasantries (sure/certainly/of course/happy to), hedging. Fragments OK. Short synonyms (big not extensive, fix not "implement a solution"). Technical terms exact. Code blocks unchanged. Errors quoted exact.

Pattern: [thing] [action] [reason]. [next step].

Drop caveman temporarily for: security warnings, irreversible action confirmations, multi-step sequences where order is ambiguous, user clarification requests. Resume after clear part done.

Code/commits/PRs: write normal. Caveman applies to user-facing text only.`

interface DevConfig {
  language?: string
  variant?: string
  workflow?: string
  commands?: {
    dev?: string
    build?: string
    test?: string
    typecheck?: string
    lint?: string
    format?: string
  }
}

interface PackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T
  } catch {
    return null
  }
}

function readRustDeps(cargoPath: string): string {
  try {
    const content = readFileSync(cargoPath, 'utf8')
    const deps = content
      .split('\n')
      .filter((line) => /^[a-z_][a-z0-9_-]*\s*=/.test(line))
      .map((line) => line.split(/\s*=/)[0].trim())
    return deps.join(', ')
  } catch {
    return ''
  }
}

function readGoDeps(goModPath: string): string {
  try {
    const content = readFileSync(goModPath, 'utf8')
    const deps = content
      .split('\n')
      .flatMap((line) => {
        const match = line.match(/([a-z0-9./_-]+ v[0-9][^ ]*)/)
        return match ? [match[1].split(' ')[0]] : []
      })
    return deps.join(', ')
  } catch {
    return ''
  }
}

function buildDepsText(language: string | undefined, cwd: string): string {
  if (!language) return ''

  if (language === 'typescript') {
    const pkg = readJson<PackageJson>(join(cwd, 'package.json'))
    if (!pkg) return ''
    const allDeps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    }
    const names = Object.keys(allDeps)
    return names.length > 0 ? names.join(', ') : ''
  }

  if (language === 'rust') {
    return readRustDeps(join(cwd, 'Cargo.toml'))
  }

  if (language === 'go') {
    return readGoDeps(join(cwd, 'go.mod'))
  }

  return ''
}

function buildContextText(input: HookInput): string {
  const cwd = input.cwd ?? process.cwd()
  const config = readJson<DevConfig>(join(cwd, '.dev.config.json'))

  let context = CAVEMAN_MODE_TEXT

  if (config) {
    const cmds = config.commands ?? {}
    const projectInfo = [
      `Project: ${config.variant ?? ''} (${config.language ?? ''}) | workflow: ${config.workflow ?? ''}`,
      '',
      'Commands (use these exact strings — do not guess alternatives):',
      `  dev:       ${cmds.dev ?? ''}`,
      `  build:     ${cmds.build ?? ''}`,
      `  test:      ${cmds.test ?? ''}`,
      `  typecheck: ${cmds.typecheck ?? ''}`,
      `  lint:      ${cmds.lint ?? ''}`,
      `  format:    ${cmds.format ?? ''}`,
    ].join('\n')

    context = `${context}\n\n${projectInfo}`

    const deps = buildDepsText(config.language, cwd)
    if (deps.length > 0) {
      context = `${context}\n\nInstalled dependencies: ${deps}\nDo not import packages not in this list — import-validator hook blocks fabricated imports.`
    }
  }

  return context
}

export const contextBootstrap: HookHandler = (input): HookDecision => {
  const text = buildContextText(input)
  return { kind: 'context', event: 'SessionStart', text }
}
