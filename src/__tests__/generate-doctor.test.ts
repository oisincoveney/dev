import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runDoctorCheck } from '../doctor.js'
import { runGenerateCheck } from '../generate.js'
import { applyInternalTemplate, templateDataFromConfig, writeInternalState } from '../orchestrator.js'
import type { DevConfig } from '../config.js'

const config: DevConfig = {
  language: 'typescript',
  variant: 'ts-library',
  framework: null,
  packageManager: 'bun',
  commands: {
    dev: 'bun run test:watch',
    build: 'bun run build',
    test: 'bun test',
    typecheck: 'tsc --noEmit',
    lint: 'echo "no lint configured"',
    format: 'echo "no format configured"',
  },
  skills: ['tracker-workflow'],
  tools: ['backlog'],
  workflow: 'backlog',
  contractDriven: false,
  targets: ['claude', 'codex', 'opencode', 'cursor', 'lefthook'],
}

describe('generate and doctor', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'generate-doctor-'))
    const data = templateDataFromConfig(config)
    writeInternalState(dir, data)
    applyInternalTemplate(dir, data)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('reports generated files as current after rendering', () => {
    expect(runGenerateCheck(dir)).toEqual({ ok: true, changed: [] })
    expect(runDoctorCheck(dir)).toEqual({ ok: true, findings: [] })
  })

  it('detects generated drift and stale hook trees', () => {
    writeFileSync(join(dir, 'AGENTS.md'), `${readFileSync(join(dir, 'AGENTS.md'), 'utf8')}\nmanual edit\n`)
    mkdirSync(join(dir, '.claude', 'hooks'), { recursive: true })

    const generate = runGenerateCheck(dir)
    expect(generate.ok).toBe(false)
    expect(generate.changed).toContain('AGENTS.md')

    const doctor = runDoctorCheck(dir)
    expect(doctor.ok).toBe(false)
    expect(doctor.findings.join('\n')).toContain('Generated drift')
    expect(doctor.findings.join('\n')).toContain('.claude/hooks')
  })
})
