import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyInternalTemplate, bootstrapInternalStateFromLegacyConfig, readInternalState, STATE_FILE } from './orchestrator.js'
import { runGenerateCheck } from './generate.js'

export interface DoctorReport {
  ok: boolean
  findings: string[]
}

function fileContains(cwd: string, path: string, needle: string): boolean {
  const full = join(cwd, path)
  return existsSync(full) && readFileSync(full, 'utf8').includes(needle)
}

export function runDoctorCheck(cwd: string): DoctorReport {
  const findings: string[] = []
  const bootstrap = bootstrapInternalStateFromLegacyConfig(cwd)
  if (!bootstrap.ok) findings.push(bootstrap.message)
  const state = readInternalState(cwd)
  if (state === null) findings.push(`Missing ${STATE_FILE} state`)
  const generated = runGenerateCheck(cwd)
  if (!generated.ok) findings.push(`Generated drift: ${generated.changed.join(', ')}`)
  if (existsSync(join(cwd, '.claude', 'hooks'))) findings.push('Stale generated hook tree: .claude/hooks')
  if (existsSync(join(cwd, '.codex', 'hooks'))) findings.push('Stale generated hook tree: .codex/hooks')
  for (const stale of [
    'No Worktrunk setup for `/quick`',
    'explicit `/quick` inline edits',
    'bd prime',
    'steveyegge/beads',
  ]) {
    if (
      fileContains(cwd, 'AGENTS.md', stale) ||
      fileContains(cwd, 'mise.toml', stale) ||
      fileContains(cwd, '.claude/settings.json', stale) ||
      fileContains(cwd, '.codex/hooks.json', stale)
    ) {
      findings.push(`Stale policy text: ${stale}`)
    }
  }
  if (!existsSync(join(cwd, '.agents', 'hooks', 'pre-tool-dispatch.sh'))) {
    findings.push('Missing shared hook runtime: .agents/hooks/pre-tool-dispatch.sh')
  }
  if (!existsSync(join(cwd, '.agents', 'skills', 'tracker-workflow', 'SKILL.md'))) {
    findings.push('Missing tracker workflow skill')
  }
  return { ok: findings.length === 0, findings }
}

export function runDoctor(argv: ReadonlyArray<string> = process.argv.slice(3)): void {
  const cwd = process.cwd()
  if (argv.includes('--fix')) {
    const bootstrap = bootstrapInternalStateFromLegacyConfig(cwd)
    if (!bootstrap.ok) {
      process.stderr.write(`doctor: ${bootstrap.message}\n`)
      process.exit(1)
    }
    const state = readInternalState(cwd)
    if (state !== null) applyInternalTemplate(cwd, state)
  }
  const report = runDoctorCheck(cwd)
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } else if (report.ok) {
    process.stdout.write('doctor: ok\n')
  } else {
    process.stderr.write(`doctor: found ${report.findings.length} issue(s)\n${report.findings.map((finding) => `- ${finding}`).join('\n')}\n`)
  }
  if (!report.ok) process.exit(1)
}
