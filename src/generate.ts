import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { applyInternalTemplate, bootstrapInternalStateFromLegacyConfig, readInternalState, STATE_FILE } from './orchestrator.js'

const GENERATED_PATHS = [
  'AGENTS.md',
  'CLAUDE.md',
  'agents.toml',
  'mise.toml',
  'lefthook.yml',
  '.claude/settings.json',
  '.codex/hooks.json',
  '.opencode/plugins/dev-enforcer.ts',
  '.cursor/rules/project.mdc',
  '.config/wt.toml',
] as const

export interface GenerateCheckResult {
  ok: boolean
  changed: string[]
}

export function runGenerateCheck(cwd: string): GenerateCheckResult {
  const bootstrap = bootstrapInternalStateFromLegacyConfig(cwd)
  if (!bootstrap.ok) return { ok: false, changed: [bootstrap.message] }
  const state = readInternalState(cwd)
  if (state === null) return { ok: false, changed: [`${STATE_FILE} missing`] }
  const temp = mkdtempSync(join(tmpdir(), 'oisin-generate-check-'))
  try {
    for (const path of GENERATED_PATHS) {
      const current = join(cwd, path)
      if (!existsSync(current)) continue
      const target = join(temp, path)
      mkdirSync(dirname(target), { recursive: true })
      cpSync(current, target, { recursive: true, dereference: false })
    }
    applyInternalTemplate(temp, state)
    const changed: string[] = []
    for (const path of GENERATED_PATHS) {
      try {
        const current = readFileSync(join(cwd, path), 'utf8')
        const expected = readFileSync(join(temp, path), 'utf8')
        if (current !== expected) changed.push(path)
      } catch {
        changed.push(path)
      }
    }
    return { ok: changed.length === 0, changed }
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

export function runGenerate(argv: ReadonlyArray<string> = process.argv.slice(3)): void {
  const cwd = process.cwd()
  const bootstrap = bootstrapInternalStateFromLegacyConfig(cwd)
  if (!bootstrap.ok) {
    process.stderr.write(`generate: ${bootstrap.message}\n`)
    process.exit(1)
  }
  const state = readInternalState(cwd)
  if (state === null) {
    process.stderr.write(`generate: no ${STATE_FILE} found. Run init first.\n`)
    process.exit(1)
  }
  if (argv.includes('--check')) {
    const result = runGenerateCheck(cwd)
    if (!result.ok) {
      process.stderr.write(`Generated files are out of date:\n${result.changed.map((path) => `- ${path}`).join('\n')}\n`)
      process.exit(1)
    }
    process.stdout.write('Generated files are current.\n')
    return
  }
  applyInternalTemplate(cwd, state)
  process.stdout.write(`Generated harness files in ${relative(process.cwd(), cwd) || '.'}.\n`)
}
