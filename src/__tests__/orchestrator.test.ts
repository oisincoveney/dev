import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyInternalTemplate,
  copierMiseArgs,
  runInitOrchestration,
  STATE_FILE,
  templateDataFromAnswers,
} from '../orchestrator.js'
import type { Answers } from '../prompts.js'

const answers: Answers = {
  language: 'typescript',
  variant: 'ts-library',
  languages: ['typescript'],
  variants: ['ts-library'],
  framework: null,
  packageManager: 'bun',
  commands: {
    dev: 'bun run test:watch',
    build: 'bun run build',
    test: 'bun test',
    typecheck: 'tsc --noEmit',
    lint: 'biome check .',
    format: 'biome format --write .',
  },
  skills: ['code-quality', 'architecture'],
  tools: ['beads'],
  workflow: 'bd',
  contractDriven: false,
  targets: ['claude', 'codex', 'opencode', 'cursor', 'lefthook'],
  mcpServers: [],
}

describe('thin orchestrator', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'oisin-orchestrator-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('maps prompt answers to Copier template data', () => {
    const data = templateDataFromAnswers(answers)

    expect(data.commands).toMatchObject({
      dev: 'bun run test:watch',
      test: 'bun test',
      typecheck: 'tsc --noEmit',
    })
    expect(data.beads_enabled).toBe(true)
    expect(data.has_typescript).toBe(true)
    expect(data.targets).toContain('opencode')
  })

  it('runs copier through the qualified mise pipx tool spec', () => {
    expect(copierMiseArgs('recopy', '--trust', '--force')).toEqual([
      'exec',
      'pipx:copier@9.14.0',
      '--',
      'copier',
      'recopy',
      '--trust',
      '--force',
    ])
  })

  it('renders the harness fallback with mise-managed tool declarations', () => {
    const data = templateDataFromAnswers(answers)
    applyInternalTemplate(dir, data)

    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toContain('Use the tracker workflow for planned work')
    expect(readFileSync(join(dir, 'mise.toml'), 'utf8')).toContain('[tasks.test]')
    expect(readFileSync(join(dir, 'mise.toml'), 'utf8')).toContain('run = "bun test"')
    expect(readFileSync(join(dir, 'mise.toml'), 'utf8')).toContain('"pipx:copier"')
    expect(readFileSync(join(dir, 'mise.toml'), 'utf8')).toContain('"npm:@sentry/dotagents"')
    expect(readFileSync(join(dir, 'lefthook.yml'), 'utf8')).toContain('mise run test')
    expect(existsSync(join(dir, '.claude/hooks/pre-tool-dispatch.sh'))).toBe(true)
    expect(existsSync(join(dir, '.codex/hooks.json'))).toBe(true)
    expect(existsSync(join(dir, '.opencode/plugins/dev-enforcer.ts'))).toBe(true)
    expect(existsSync(join(dir, '.claude/skills/tracker-workflow'))).toBe(true)

    const claudeSettings = readFileSync(join(dir, '.claude/settings.json'), 'utf8')
    expect(claudeSettings).toContain('context-bootstrap.sh')
    expect(claudeSettings).toContain('baseline-pin.sh')
    expect(claudeSettings).toContain('pre-tool-dispatch.sh')
    expect(claudeSettings).toContain('pre-stop-verification.sh')
    expect(claudeSettings).toContain('verifier-skill-guard.sh')
    expect(claudeSettings).toContain('swarm-digest.sh')

    const opencode = readFileSync(join(dir, '.opencode/plugins/dev-enforcer.ts'), 'utf8')
    expect(opencode).toContain('destructive-command-guard.sh')
    expect(opencode).not.toContain('require-claim.sh')
    expect(opencode).not.toContain('require-swarm.sh')
    expect(opencode).toContain('ts-style-guard.sh')
    expect(opencode).toContain('import-validator.sh')
    expect(opencode).toContain('ai-antipattern-guard.sh')
  })

  it('writes and reads internal state on init orchestration', () => {
    const result = runInitOrchestration(dir, answers, { skipExternalTools: true })

    expect(result).toEqual({ ok: true })
    expect(existsSync(join(dir, STATE_FILE))).toBe(true)
    const state = readFileSync(join(dir, STATE_FILE), 'utf8')
    expect(state).toContain('"variant":"ts-library"')
    expect(() => JSON.parse(state)).not.toThrow()
  })
})
