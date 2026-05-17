import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  applyInternalTemplate,
  copierMiseArgs,
  mergeLefthookCommands,
  mergeMiseToolLines,
  mergeMiseTaskBlocks,
  runInitOrchestration,
  runUpdateOrchestration,
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

    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(agents).toContain('Use the tracker workflow for planned work')
    expect(agents).toContain('Main thread is the orchestrator')
    expect(agents).toContain('Worktrunk')
    expect(agents).toContain('All implementation, including `/quick`, runs in Worktrunk-managed agent worktrees')
    expect(agents).toContain('It still runs in a Worktrunk-managed agent worktree')
    expect(agents).toContain('Agent implementation work must use Worktrunk (`wt`) git worktrees under `.agents/worktrees/<task-or-branch>`')
    expect(agents).not.toContain('Current checkout is allowed for answer-only, investigation-only, and explicit `/quick` inline edits')
    expect(agents).toContain('full clones')
    expect(agents).toContain('Caveman mode is the default communication style')
    expect(agents).toContain('question means answer only')
    expect(agents).toContain('investigate/research means report only')
    expect(agents).toContain('`/quick` means Worktrunk quick worktree')
    expect(agents).toContain('`/work-next` or approved tracker work means Worktrunk implementation')
    expect(agents).toContain('use official docs/web first')
    expect(agents).toContain('dependency/generated files only as last resort')
    expect(agents).toContain('Do not end with follow-up prompts')
    expect(agents).not.toContain('codex_hooks')
    expect(readFileSync(join(dir, 'mise.toml'), 'utf8')).toContain('[tasks.test]')
    expect(readFileSync(join(dir, 'mise.toml'), 'utf8')).toContain('run = "bun test"')
    expect(readFileSync(join(dir, 'mise.toml'), 'utf8')).toContain('"pipx:copier"')
    expect(readFileSync(join(dir, 'mise.toml'), 'utf8')).toContain('"npm:@sentry/dotagents"')
    expect(readFileSync(join(dir, 'mise.toml'), 'utf8')).toContain('"github:max-sixty/worktrunk"')
    expect(readFileSync(join(dir, 'mise.toml'), 'utf8')).toContain('[tasks."worktree:setup"]')
    expect(readFileSync(join(dir, 'mise.toml'), 'utf8')).toContain('[tasks."worktree:verify"]')
    expect(readFileSync(join(dir, 'mise.toml'), 'utf8')).toContain('[tasks."worktree:teardown"]')
    expect(readFileSync(join(dir, '.config/wt.toml'), 'utf8')).toContain('mise run worktree:setup')
    expect(readFileSync(join(dir, '.config/wt.toml'), 'utf8')).toContain('.agents/worktrees')
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain('.agents/worktrees/')
    expect(readFileSync(join(dir, 'lefthook.yml'), 'utf8')).toContain('mise run test')
    expect(existsSync(join(dir, '.claude/hooks/pre-tool-dispatch.sh'))).toBe(true)
    expect(existsSync(join(dir, '.claude/commands/quick.md'))).toBe(true)
    expect(existsSync(join(dir, '.claude/commands/plan.md'))).toBe(true)
    expect(existsSync(join(dir, '.claude/commands/approve.md'))).toBe(true)
    expect(existsSync(join(dir, '.claude/commands/work-next.md'))).toBe(true)
    expect(existsSync(join(dir, '.claude/commands/finish.md'))).toBe(true)
    expect(existsSync(join(dir, '.agents/skills/quick/SKILL.md'))).toBe(true)
    expect(existsSync(join(dir, '.agents/skills/plan/SKILL.md'))).toBe(true)
    expect(existsSync(join(dir, '.agents/skills/approve/SKILL.md'))).toBe(true)
    expect(existsSync(join(dir, '.agents/skills/work-next/SKILL.md'))).toBe(true)
    expect(existsSync(join(dir, '.agents/skills/finish/SKILL.md'))).toBe(true)
    expect(existsSync(join(dir, '.codex/hooks.json'))).toBe(true)
    expect(existsSync(join(dir, '.opencode/plugins/dev-enforcer.ts'))).toBe(true)
    expect(existsSync(join(dir, '.opencode/commands/quick.md'))).toBe(true)
    expect(existsSync(join(dir, '.opencode/commands/plan.md'))).toBe(true)
    expect(existsSync(join(dir, '.opencode/commands/approve.md'))).toBe(true)
    expect(existsSync(join(dir, '.opencode/commands/work-next.md'))).toBe(true)
    expect(existsSync(join(dir, '.opencode/commands/finish.md'))).toBe(true)
    expect(existsSync(join(dir, '.codex/skills/quick'))).toBe(true)
    expect(existsSync(join(dir, '.opencode/skills/quick'))).toBe(true)
    expect(existsSync(join(dir, '.cursor/skills/quick'))).toBe(true)
    expect(existsSync(join(dir, '.claude/skills/tracker-workflow'))).toBe(true)

    expect(readFileSync(join(dir, '.claude/commands/quick.md'), 'utf8')).toContain('Worktrunk-managed quick task')
    expect(readFileSync(join(dir, '.opencode/commands/quick.md'), 'utf8')).toContain('Worktrunk-managed quick task')
    expect(readFileSync(join(dir, '.agents/skills/quick/SKILL.md'), 'utf8')).toContain('Do not edit in the current checkout')
    expect(readFileSync(join(dir, '.agents/skills/tracker-workflow/SKILL.md'), 'utf8')).toContain('including `/quick`')
    expect(readFileSync(join(dir, '.agents/skills/tracker-workflow/SKILL.md'), 'utf8')).not.toContain('No Worktrunk setup')
    expect(readFileSync(join(dir, '.agents/skills/work-next/SKILL.md'), 'utf8')).toContain('Worktrunk-managed')

    const claudeSettings = readFileSync(join(dir, '.claude/settings.json'), 'utf8')
    expect(claudeSettings).toContain('context-bootstrap.sh')
    expect(claudeSettings).toContain('baseline-pin.sh')
    expect(claudeSettings).toContain('pre-tool-dispatch.sh')
    expect(claudeSettings).toContain('pre-stop-verification.sh')
    expect(claudeSettings).toContain('verifier-skill-guard.sh')
    expect(claudeSettings).toContain('swarm-digest.sh')

    const bootstrap = readFileSync(join(dir, '.claude/hooks/context-bootstrap.sh'), 'utf8')
    expect(bootstrap).toContain('COMMUNICATION MODE — caveman')
    expect(bootstrap).toContain('question means answer only')
    expect(bootstrap).toContain('/quick means Worktrunk quick worktree')
    expect(bootstrap).toContain('Agent implementation work, including /quick, must use Worktrunk worktrees under .agents/worktrees/.')
    expect(bootstrap).not.toContain('Explicit /quick edits stay inline on the current branch')
    expect(bootstrap).toContain('official docs/web first')
    expect(bootstrap).toContain('No terminal follow-up prompts')

    const opencode = readFileSync(join(dir, '.opencode/plugins/dev-enforcer.ts'), 'utf8')
    expect(opencode).toContain('destructive-command-guard.sh')
    expect(opencode).toContain('WORKTREE_POLICY')
    expect(opencode).not.toContain('require-claim.sh')
    expect(opencode).not.toContain('require-swarm.sh')
    expect(opencode).toContain('ts-style-guard.sh')
    expect(opencode).toContain('import-validator.sh')
    expect(opencode).toContain('ai-antipattern-guard.sh')
  })

  it('preserves existing mise tasks while adding harness tools', () => {
    writeFileSync(
      join(dir, 'mise.toml'),
      '[tools]\nnode = "22"\n\n[tasks.test]\nrun = "npm test"\n',
    )

    applyInternalTemplate(dir, templateDataFromAnswers(answers))

    const mise = readFileSync(join(dir, 'mise.toml'), 'utf8')
    expect(mise).toContain('node = "22"')
    expect(mise).toContain('[tasks.test]\nrun = "npm test"')
    expect(mise).toContain('"pipx:copier" = "9.14.0"')
    expect(mise).toContain('"npm:@sentry/dotagents" = "latest"')
    expect(mise).toContain('"aqua:evilmartians/lefthook" = "latest"')
    expect(mise).toContain('"github:max-sixty/worktrunk" = "latest"')
    expect(mise).toContain('"aqua:steveyegge/beads" = "1.0.2"')
    expect(mise).toContain('[tasks.typecheck]')
    expect(mise).toContain('run = "tsc --noEmit"')
    expect(mise).toContain('[tasks."worktree:verify"]')
  })

  it('can add harness tools to a mise file without a tools section', () => {
    expect(mergeMiseToolLines('[tasks.test]\nrun = "npm test"\n', ['"pipx:copier" = "9.14.0"'])).toBe(
      '[tools]\n"pipx:copier" = "9.14.0"\n\n[tasks.test]\nrun = "npm test"\n',
    )
  })

  it('can add missing mise tasks while preserving existing task definitions', () => {
    expect(
      mergeMiseTaskBlocks('[tasks.test]\nrun = "npm test"\n', {
        test: 'bun test',
        typecheck: 'tsc --noEmit',
      }),
    ).toContain('[tasks.typecheck]\nrun = "tsc --noEmit"')
  })

  it('preserves existing lefthook commands while adding harness commands', () => {
    writeFileSync(
      join(dir, 'lefthook.yml'),
      [
        'pre-commit:',
        '  parallel: true',
        '  commands:',
        '    repo-lint:',
        '      run: npm run lint',
        '',
        'post-commit:',
        '  commands:',
        '    bd-dolt-push:',
        '      run: .claude/hooks/beads-sync.sh push-best-effort',
        '',
        'post-merge:',
        '  commands:',
        '    repo-sync:',
        '      run: npm run sync',
        '    bd-dolt-pull:',
        '      run: .claude/hooks/beads-sync.sh pull-best-effort',
        '',
        'pre-push:',
        '  commands:',
        '    repo-test:',
        '      run: npm test',
        '    bd-dolt-push:',
        '      run: .claude/hooks/beads-sync.sh push-best-effort',
        '',
      ].join('\n'),
    )

    applyInternalTemplate(dir, templateDataFromAnswers(answers))

    const lefthook = readFileSync(join(dir, 'lefthook.yml'), 'utf8')
    expect(lefthook).toContain('repo-lint:')
    expect(lefthook).toContain('run: npm run lint')
    expect(lefthook).toContain('repo-test:')
    expect(lefthook).toContain('run: npm test')
    expect(lefthook).toContain('repo-sync:')
    expect(lefthook).toContain('run: npm run sync')
    expect(lefthook).toContain('conventional-commits:')
    expect(lefthook).toContain('bd-ticket-ref:')
    expect(lefthook).toContain('typecheck:')
    expect(lefthook).toContain('run: mise run typecheck')
    expect(lefthook).not.toContain('bd-dolt-push:')
    expect(lefthook).not.toContain('bd-dolt-pull:')
    expect(lefthook).not.toContain('beads-sync.sh')
    expect(lefthook).toContain('pr-size-check:')
  })

  it('can add lefthook commands when a hook has no commands section', () => {
    const merged = mergeLefthookCommands('pre-commit:\n  parallel: true\n', {
      'pre-commit': {
        typecheck: { run: 'mise run typecheck' },
      },
    })

    expect(parse(merged)).toEqual({
      'pre-commit': {
        parallel: true,
        commands: {
          typecheck: {
            run: 'mise run typecheck',
          },
        },
      },
    })
  })

  it('writes and reads internal state on init orchestration', () => {
    const result = runInitOrchestration(dir, answers, { skipExternalTools: true })

    expect(result).toEqual({ ok: true })
    expect(existsSync(join(dir, STATE_FILE))).toBe(true)
    const state = readFileSync(join(dir, STATE_FILE), 'utf8')
    expect(state).toContain('"variant":"ts-library"')
    expect(() => JSON.parse(state)).not.toThrow()
  })

  it('reads YAML Copier answers during update orchestration', () => {
    writeFileSync(
      join(dir, STATE_FILE),
      [
        '_src_path: /tmp/template',
        'language: typescript',
        'variant: ts-library',
        'languages:',
        '  - typescript',
        'variants:',
        '  - ts-library',
        'framework: ""',
        'package_manager: bun',
        'commands:',
        '  test: bun test',
        '  typecheck: tsc --noEmit',
        'skills:',
        '  - code-quality',
        'tools:',
        '  - beads',
        'workflow: bd',
        'contract_driven: false',
        'targets:',
        '  - claude',
        '  - codex',
        'mcp_servers: []',
        'models: {}',
        'beads_enabled: true',
        'has_typescript: true',
        'has_frontend: false',
        '',
      ].join('\n'),
    )

    expect(runUpdateOrchestration(dir, { skipExternalTools: true })).toEqual({ ok: true })

    const claudeSettings = readFileSync(join(dir, '.claude/settings.json'), 'utf8')
    expect(claudeSettings).toContain('OISIN_DEV_BEADS=1')
    expect(claudeSettings).toContain('bd-context-inject.sh')
    expect(existsSync(join(dir, '.codex/skills/caveman'))).toBe(true)
  })

  it('prunes retired generated hook files during update', () => {
    expect(runInitOrchestration(dir, answers, { skipExternalTools: true })).toEqual({ ok: true })
    mkdirSync(join(dir, '.claude/hooks'), { recursive: true })
    mkdirSync(join(dir, '.codex/hooks'), { recursive: true })
    writeFileSync(join(dir, '.claude/hooks/tdd-guard.sh'), 'old')
    writeFileSync(join(dir, '.codex/hooks/tdd-guard.sh'), 'old')

    expect(runUpdateOrchestration(dir, { skipExternalTools: true })).toEqual({ ok: true })

    expect(existsSync(join(dir, '.claude/hooks/tdd-guard.sh'))).toBe(false)
    expect(existsSync(join(dir, '.codex/hooks/tdd-guard.sh'))).toBe(false)
  })
})
