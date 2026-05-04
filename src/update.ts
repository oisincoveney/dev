/**
 * `oisin-dev update`
 *
 * Re-syncs generated files (hook scripts, .claude/docs/ fragments, settings)
 * from the existing .dev.config.json without running prompts and without
 * touching user-customised files (lefthook.yml, lint configs).
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as p from '@clack/prompts'
import { type DevConfig, type Language, readConfig, writeConfig } from './config.js'
import {
  installAll,
  removeLegacyRetiredPaths,
  seedConstitutionDecisions,
  stripLegacyConfigFields,
  trimBeadsIntegrationOnAgentDocs,
} from './install.js'
import type { DriftCandidate, DriftDecision } from './manifest.js'
import { ALL_VARIANT_OPTIONS, promptVariants } from './prompts.js'
import type { ProjectVariant } from './skills.js'

export async function runUpdate(): Promise<void> {
  p.intro('@oisincoveney/dev update')

  const cwd = process.cwd()
  const config = readConfig(cwd)

  if (!config) {
    p.log.error('No .dev.config.json found. Run `init` first.')
    process.exit(1)
  }

  // Default `update` runs without language prompts. Opt in via flags:
  //   --reconfigure-languages         interactive multiselect (re-run variants prompt)
  //   --languages=<v1>,<v2>,...       set variants explicitly (non-interactive)
  //   --add-language=<variant>        append a variant (repeatable)
  //   --remove-language=<variant>     drop a variant (repeatable)
  const reconfigured = await maybeReconfigureLanguages(cwd, config)
  if (reconfigured) p.log.success('Languages updated.')

  if (existsSync(join(cwd, '.claude', 'docs'))) {
    p.log.warn(
      'Detected legacy `.claude/docs/` directory. Instructions now live in `.claude/rules/` — review any custom edits, then delete `.claude/docs/`.',
    )
  }

  p.log.info(`Re-syncing ${config.variant} project from .dev.config.json`)

  const legacy = removeLegacyRetiredPaths(cwd)
  for (const path of legacy.removed) p.log.info(`removed orphan: ${path}`)
  for (const warning of legacy.warnings) p.log.warn(warning)

  const trimmed = trimBeadsIntegrationOnAgentDocs(cwd)
  for (const file of trimmed) p.log.info(`trimmed BEADS INTEGRATION block: ${file}`)

  const stripped = stripLegacyConfigFields(cwd)
  for (const field of stripped) p.log.info(`stripped removed config field: ${field}`)

  if (config.tools.includes('beads') && config.workflow === 'bd' && existsSync(join(cwd, '.beads'))) {
    const seed = seedConstitutionDecisions(cwd, config)
    if (seed.ok && seed.created > 0) {
      p.log.info(`seeded ${seed.created} constitution decision(s)`)
    }
  }

  const acceptLefthook = process.argv.includes('--accept-lefthook-overwrite')
  const isInteractive = process.stdout.isTTY === true && process.stdin.isTTY === true

  const result = await installAll(cwd, config, {} as never, {
    skipSideEffects: true,
    isUpdate: true,
    acceptLefthookOverwrite: acceptLefthook,
    onDrift: isInteractive ? promptDrift : undefined,
  })

  if (result.manifest) {
    if (result.manifest.lefthookDrift && !acceptLefthook) {
      p.log.error(
        'lefthook.yml has drifted from what we shipped. Halting update.\n' +
          '  - To accept the new lefthook.yml (overwrite yours): re-run with --accept-lefthook-overwrite\n' +
          '  - To keep your version and update the manifest to match: run `oisin-dev accept-lefthook`\n' +
          '  - Otherwise diff and reconcile manually before re-running update.',
      )
      process.exit(1)
    }

    if (result.manifest.promptKept.length > 0) {
      p.log.info(
        `Kept your version of ${result.manifest.promptKept.length} file(s): ${result.manifest.promptKept.join(', ')}`,
      )
    }

    if (result.manifest.devNew.length > 0) {
      p.log.warn(
        `Drifted files written as .dev-new sidecars (non-interactive run): ${result.manifest.devNew.join(', ')}. Diff and reconcile.`,
      )
    }

    if (result.manifest.removed.length > 0) {
      p.log.info(`Removed retired files: ${result.manifest.removed.join(', ')}.`)
    }
  }

  p.outro('Commit the updated files.')
}

async function promptDrift(candidate: DriftCandidate): Promise<DriftDecision> {
  while (true) {
    const choice = await p.select<'keep' | 'take' | 'diff' | 'abort'>({
      message: `${candidate.relPath} differs from what 0.x ships. ${candidate.severity === 'super' ? 'Heavily modified.' : 'Mildly modified.'} What do you want to do?`,
      options: [
        { value: 'take', label: 'Take new version (overwrite mine)' },
        { value: 'keep', label: 'Keep my version (manifest hash will match mine)' },
        { value: 'diff', label: 'Show diff first' },
        { value: 'abort', label: 'Abort update' },
      ],
    })

    if (p.isCancel(choice) || choice === 'abort') return 'abort'
    if (choice === 'keep') return 'keep'
    if (choice === 'take') return 'take'

    showDiff(candidate)
  }
}

async function maybeReconfigureLanguages(cwd: string, config: DevConfig): Promise<boolean> {
  const argv = process.argv.slice(2)
  const reconfigure = argv.includes('--reconfigure-languages')
  const explicit = pickArgValue(argv, '--languages')
  const adds = pickAllArgValues(argv, '--add-language')
  const removes = pickAllArgValues(argv, '--remove-language')

  if (!reconfigure && explicit === null && adds.length === 0 && removes.length === 0) {
    return false
  }

  const current = currentVariants(config)
  let next: ReadonlyArray<ProjectVariant> = current

  if (explicit !== null) {
    next = parseVariantList(explicit)
  } else if (reconfigure) {
    next = await promptVariants(current[0])
  }

  if (adds.length > 0 || removes.length > 0) {
    const set = new Set<ProjectVariant>(next)
    for (const v of adds) {
      const parsed = parseVariant(v)
      if (parsed) set.add(parsed)
    }
    for (const v of removes) {
      const parsed = parseVariant(v)
      if (parsed) set.delete(parsed)
    }
    const ordered: ProjectVariant[] = []
    for (const v of next) if (set.has(v)) ordered.push(v)
    for (const v of adds) {
      const parsed = parseVariant(v)
      if (parsed && !ordered.includes(parsed)) ordered.push(parsed)
    }
    next = ordered
  }

  if (next.length === 0) {
    p.log.error('At least one variant is required. Aborting language reconfiguration.')
    process.exit(1)
  }

  if (sameVariants(current, next)) {
    p.log.info('Languages unchanged.')
    return false
  }

  const updated: DevConfig = {
    ...config,
    variant: next[0],
    language: languageForVariant(next[0]),
    variants: next,
    languages: uniqueLanguages(next),
  }
  writeConfig(cwd, updated)
  Object.assign(config, updated)
  return true
}

function pickArgValue(argv: string[], name: string): string | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === name) {
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) return next
    }
    if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1)
  }
  return null
}

function pickAllArgValues(argv: string[], name: string): string[] {
  const out: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === name) {
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        out.push(next)
        i += 1
      }
    } else if (arg.startsWith(`${name}=`)) {
      out.push(arg.slice(name.length + 1))
    }
  }
  return out
}

function parseVariantList(raw: string): ReadonlyArray<ProjectVariant> {
  const out: ProjectVariant[] = []
  for (const part of raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0)) {
    const parsed = parseVariant(part)
    if (parsed === null) {
      p.log.error(`Unknown variant "${part}". Valid: ${variantNames().join(', ')}`)
      process.exit(1)
    }
    if (!out.includes(parsed)) out.push(parsed)
  }
  return out
}

function parseVariant(value: string): ProjectVariant | null {
  return ALL_VARIANT_OPTIONS.some((opt) => opt.value === value) ? (value as ProjectVariant) : null
}

function variantNames(): string[] {
  return ALL_VARIANT_OPTIONS.map((opt) => opt.value)
}

function currentVariants(config: DevConfig): ReadonlyArray<ProjectVariant> {
  if (config.variants !== undefined && config.variants.length > 0) return config.variants
  return [config.variant]
}

function sameVariants(a: ReadonlyArray<ProjectVariant>, b: ReadonlyArray<ProjectVariant>): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function languageForVariant(variant: ProjectVariant): Language {
  if (variant.startsWith('ts-')) return 'typescript'
  if (variant.startsWith('rust-')) return 'rust'
  if (variant.startsWith('swift-')) return 'swift'
  if (variant.startsWith('other-')) return 'other'
  return 'go'
}

function uniqueLanguages(variants: ReadonlyArray<ProjectVariant>): ReadonlyArray<Language> {
  const seen = new Set<Language>()
  const out: Language[] = []
  for (const v of variants) {
    const lang = languageForVariant(v)
    if (!seen.has(lang)) {
      seen.add(lang)
      out.push(lang)
    }
  }
  return out
}

function showDiff(candidate: DriftCandidate): void {
  const tmp = mkdtempSync(join(tmpdir(), 'oisin-dev-diff-'))
  const currentPath = join(tmp, 'current')
  const newPath = join(tmp, 'new')
  try {
    writeFileSync(currentPath, candidate.currentContent)
    writeFileSync(newPath, candidate.newContent)
    try {
      execSync(`git --no-pager diff --no-index --color=always "${currentPath}" "${newPath}"`, {
        stdio: 'inherit',
      })
    } catch {
      // git diff --no-index exits 1 when files differ — that's expected.
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}
