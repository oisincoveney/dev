import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DevConfig } from '../config.js'
import {
  installAll,
  mergeClaudeSettings,
  mergeManagedBlock,
  removeLegacyRetiredPaths,
  stripLegacyConfigFields,
  trimBeadsIntegrationOnAgentDocs,
} from '../install.js'
import type { Answers } from '../prompts.js'
import { RULE_SKILLS } from '../skills.js'

const fakeAnswers: Answers = {
  language: 'rust',
  variant: 'rust-bin',
  framework: null,
  packageManager: 'cargo',
  commands: {
    dev: 'cargo run',
    build: 'cargo build --release',
    test: 'cargo test',
    typecheck: 'cargo check',
    lint: 'cargo clippy --all-targets -- -D warnings',
    format: 'cargo fmt',
  },
  skills: ['code-quality', 'architecture', 'testing', 'ai-behavior', 'performance'],
  tools: ['beads', 'contract-driven'],
  workflow: 'bd',
  contractDriven: true,
  targets: ['claude', 'codex', 'opencode', 'cursor', 'lefthook'],
  mcpServers: ['memory', 'serena'],
  models: {
    default: 'claude-sonnet-4-6',
    planning: 'claude-opus-4-6',
    simple_edits: 'claude-haiku-4-5-20251001',
    review: 'claude-opus-4-6',
  },
}

const fakeConfig: DevConfig = {
  language: fakeAnswers.language,
  variant: fakeAnswers.variant,
  framework: fakeAnswers.framework,
  packageManager: fakeAnswers.packageManager,
  commands: fakeAnswers.commands,
  skills: fakeAnswers.skills,
  tools: fakeAnswers.tools,
  workflow: fakeAnswers.workflow,
  contractDriven: fakeAnswers.contractDriven,
  targets: fakeAnswers.targets,
}

describe('installAll', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dev-test-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes all expected files for a Rust project', async () => {
    await installAll(dir, fakeConfig, fakeAnswers, { skipSideEffects: true })

    // Hooks copied
    expect(existsSync(join(dir, '.claude/hooks/destructive-command-guard.sh'))).toBe(true)
    expect(existsSync(join(dir, '.claude/hooks/import-validator.sh'))).toBe(true)
    expect(existsSync(join(dir, '.claude/hooks/post-edit-check.sh'))).toBe(true)
    expect(existsSync(join(dir, '.claude/hooks/block-todowrite.sh'))).toBe(true)

    // Settings
    expect(existsSync(join(dir, '.claude/settings.json'))).toBe(true)
    expect(existsSync(join(dir, '.codex/hooks.json'))).toBe(true)
    expect(existsSync(join(dir, '.codex/hooks/destructive-command-guard.sh'))).toBe(true)

    // Cursor rules — one per selected skill
    for (const id of fakeConfig.skills) {
      if (RULE_SKILLS.some((s) => s.id === id)) {
        expect(existsSync(join(dir, `.cursor/rules/${id}.mdc`))).toBe(true)
      }
    }

    // OpenCode plugin
    expect(existsSync(join(dir, '.opencode/plugins/dev-enforcer.ts'))).toBe(true)

    // Lefthook
    expect(existsSync(join(dir, 'lefthook.yml'))).toBe(true)

    // Rust lint configs
    expect(existsSync(join(dir, 'clippy.toml'))).toBe(true)
    expect(existsSync(join(dir, 'rustfmt.toml'))).toBe(true)

    // Tool configs
    expect(existsSync(join(dir, '.semgrep.yml'))).toBe(true)
    expect(existsSync(join(dir, 'commitlint.config.cjs'))).toBe(false)
    expect(existsSync(join(dir, '.cargo-mutants.toml'))).toBe(true)

    // No project scaffolding — install never writes example code
    expect(existsSync(join(dir, 'src/example/mod.rs'))).toBe(false)
    expect(existsSync(join(dir, 'tests/property_example.rs'))).toBe(false)
    expect(existsSync(join(dir, 'src/logging.rs'))).toBe(false)

    // CLAUDE.md + AGENTS.md
    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(true)
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true)

    // Vendored grill-me skill ships with MIT LICENSE preserved
    expect(existsSync(join(dir, '.claude/skills/grill-me/SKILL.md'))).toBe(true)
    expect(existsSync(join(dir, '.claude/skills/grill-me/LICENSE'))).toBe(true)
    const grillBody = readFileSync(join(dir, '.claude/skills/grill-me/SKILL.md'), 'utf8')
    expect(grillBody).toContain('Interview me relentlessly')
    expect(grillBody).toContain('Ask the questions one at a time.')
    const grillLicense = readFileSync(join(dir, '.claude/skills/grill-me/LICENSE'), 'utf8')
    expect(grillLicense).toContain('MIT License')
    expect(grillLicense).toContain('Matt Pocock')

    // Spec-verifier skill ships when beads is enabled (it's in fakeAnswers.tools)
    expect(existsSync(join(dir, '.claude/skills/spec-verifier/SKILL.md'))).toBe(true)
    const verifierBody = readFileSync(
      join(dir, '.claude/skills/spec-verifier/SKILL.md'),
      'utf8',
    )
    expect(verifierBody).toContain('fresh-context verifier')
    expect(verifierBody).toContain('PASS-WITH-FOLLOWUPS')
    expect(verifierBody).toContain('discovered-from')
    expect(verifierBody).toContain('## Forbidden')

    // Parallel-tickets skill ships when beads is enabled
    expect(existsSync(join(dir, '.claude/skills/parallel-tickets/SKILL.md'))).toBe(true)
    const parallelBody = readFileSync(
      join(dir, '.claude/skills/parallel-tickets/SKILL.md'),
      'utf8',
    )
    expect(parallelBody).toContain('isolation:')
    expect(parallelBody).toContain('Cap: 3 concurrent')
    expect(parallelBody).toContain('Failure isolation')
    expect(parallelBody).toContain("DON'T auto-abort siblings")

    // Vendored + forked to-bd-issues skill ships with MIT attribution
    expect(existsSync(join(dir, '.claude/skills/to-bd-issues/SKILL.md'))).toBe(true)
    expect(existsSync(join(dir, '.claude/skills/to-bd-issues/LICENSE'))).toBe(true)
    const toBdBody = readFileSync(join(dir, '.claude/skills/to-bd-issues/SKILL.md'), 'utf8')
    expect(toBdBody).toContain('tracer bullet')
    expect(toBdBody).toContain('bd create --graph')
    expect(toBdBody).toContain('NEEDS CLARIFICATION')
    expect(toBdBody).toContain("don't write to bd")
    const toBdLicense = readFileSync(join(dir, '.claude/skills/to-bd-issues/LICENSE'), 'utf8')
    expect(toBdLicense).toContain('Matt Pocock')
    expect(toBdLicense).toContain('derivative work')
  })

  it('settings.json has valid JSON and correct structure', async () => {
    await installAll(dir, fakeConfig, fakeAnswers, { skipSideEffects: true })
    const raw = readFileSync(join(dir, '.claude/settings.json'), 'utf8')
    const parsed = JSON.parse(raw) as {
      hooks: Record<string, unknown>
      permissions: { rules: unknown[] }
    }
    expect(parsed.hooks.PreToolUse).toBeDefined()
    expect(parsed.permissions.rules.length).toBeGreaterThan(0)
  })

  it('commands are written to .claude/rules/commands.md; CLAUDE.md stays a kernel', async () => {
    await installAll(dir, fakeConfig, fakeAnswers, { skipSideEffects: true })
    const root = readFileSync(join(dir, 'CLAUDE.md'), 'utf8')
    expect(root).not.toContain('@.claude/docs/')
    expect(root).toContain('.claude/rules/')
    expect(root.split('\n').length).toBeLessThan(50)

    const commands = readFileSync(join(dir, '.claude/rules/commands.md'), 'utf8')
    expect(commands).toContain('cargo run')
    expect(commands).toContain('cargo clippy')
    expect(commands).toMatch(/^---\nname: commands/)
  })

  it('installs the policies skill and slash commands', async () => {
    await installAll(dir, fakeConfig, fakeAnswers, { skipSideEffects: true })

    // Owned skill copied regardless of superpower selection
    const policies = readFileSync(join(dir, '.claude/skills/policies/SKILL.md'), 'utf8')
    expect(policies).toContain('name: policies')
    expect(policies).toContain('user-invocable: false')
    expect(policies).toContain('Destructive Operations')

    // /verify command references the configured commands
    const verify = readFileSync(join(dir, '.claude/commands/verify.md'), 'utf8')
    expect(verify).toContain(fakeConfig.commands.typecheck)
    expect(verify).toContain(fakeConfig.commands.test)
    expect(verify).toContain('disable-model-invocation: true')

    // /ready and /epic commands exist when beads is enabled
    expect(existsSync(join(dir, '.claude/commands/ready.md'))).toBe(true)
    expect(existsSync(join(dir, '.claude/commands/epic.md'))).toBe(true)
    // /spec is the legacy command — replaced by /epic when beads is enabled
    expect(existsSync(join(dir, '.claude/commands/spec.md'))).toBe(false)

    // Planning-gate slash commands exist when beads is enabled
    expect(existsSync(join(dir, '.claude/commands/approve.md'))).toBe(true)
    expect(existsSync(join(dir, '.claude/commands/reject.md'))).toBe(true)
    expect(existsSync(join(dir, '.claude/commands/regrill.md'))).toBe(true)
    expect(existsSync(join(dir, '.claude/commands/plan-status.md'))).toBe(true)

    // /approve writes the env-var marker (slash-command-only namespace)
    const approve = readFileSync(join(dir, '.claude/commands/approve.md'), 'utf8')
    expect(approve).toContain('OISIN_DEV_PLAN_APPROVE=1')
    expect(approve).toContain('plan-approved:')
    expect(approve).toContain('bd human dismiss')

    // Hook file for statusLine copied
    expect(existsSync(join(dir, '.claude/hooks/statusline.sh'))).toBe(true)
  })

  it('ships the planning-gate hooks, skill, rules, and rubric when beads is enabled', async () => {
    await installAll(dir, fakeConfig, fakeAnswers, { skipSideEffects: true })

    // Hooks
    expect(existsSync(join(dir, '.claude/hooks/bd-create-gate.sh'))).toBe(true)
    expect(existsSync(join(dir, '.claude/hooks/plan-approval-guard.sh'))).toBe(true)
    expect(existsSync(join(dir, '.claude/hooks/bd-remember-protect.sh'))).toBe(true)
    expect(existsSync(join(dir, '.claude/hooks/swarm-digest.sh'))).toBe(true)

    // Plan-brief skill
    expect(existsSync(join(dir, '.claude/skills/plan-brief/SKILL.md'))).toBe(true)
    const planBrief = readFileSync(join(dir, '.claude/skills/plan-brief/SKILL.md'), 'utf8')
    expect(planBrief).toContain('Stage-1')
    expect(planBrief).toContain('bd human <epic-id>')
    expect(planBrief).toContain("DON'T `bd create --graph --parent=<id>`")

    // Rules
    expect(existsSync(join(dir, '.claude/rules/dsl.md'))).toBe(true)
    expect(existsSync(join(dir, '.claude/rules/tracer-bullet.md'))).toBe(true)
    expect(existsSync(join(dir, '.claude/rules/plan-brief-flow.md'))).toBe(true)
    expect(existsSync(join(dir, '.claude/rules/human-flag-discipline.md'))).toBe(true)

    // DSL rule mentions the contract
    const dsl = readFileSync(join(dir, '.claude/rules/dsl.md'), 'utf8')
    expect(dsl).toContain('YAML frontmatter')
    expect(dsl).toContain('out_of_scope')
    expect(dsl).toContain('tracer: true')

    // Rubric + DSL helpers copied to .beads/
    expect(existsSync(join(dir, '.beads/ticket-rubric.json'))).toBe(true)
    expect(existsSync(join(dir, '.beads/dsl/parse.mjs'))).toBe(true)
    expect(existsSync(join(dir, '.beads/dsl/expand.mjs'))).toBe(true)
    expect(existsSync(join(dir, '.beads/domain-map.example.json'))).toBe(true)

    const rubric = JSON.parse(readFileSync(join(dir, '.beads/ticket-rubric.json'), 'utf8'))
    expect(rubric.epic_alone.required).toContain('domain')
    expect(rubric.epic_alone.required).toContain('out_of_scope')
    expect(rubric.task_in_graph.required).toContain('files')
    expect(rubric.task_in_graph.required).toContain('verify')
  })

  it('settings.json has planning-gate hooks in correct order', async () => {
    await installAll(dir, fakeConfig, fakeAnswers, { skipSideEffects: true })
    const settings = JSON.parse(readFileSync(join(dir, '.claude/settings.json'), 'utf8')) as {
      hooks: {
        PreToolUse: Array<{ matcher?: string; hooks: Array<{ command: string }> }>
        Stop: Array<{ hooks: Array<{ command: string }> }>
      }
    }
    const bashMatcher = settings.hooks.PreToolUse.find((e) => e.matcher === 'Bash')
    expect(bashMatcher).toBeDefined()
    const cmds = (bashMatcher?.hooks ?? []).map((h) => h.command)
    const idx = (name: string) => cmds.findIndex((c) => c.includes(name))

    // Required ordering: destructive → bd-remember-protect → plan-approval-guard → bd-create-gate → block-coauthor.
    // block-coauthor was migrated to the TS dispatcher in 0t6 — it appears as
    // `oisin-dev hook block-coauthor` instead of `block-coauthor.sh`.
    expect(idx('destructive-command-guard.sh')).toBeGreaterThanOrEqual(0)
    expect(idx('bd-remember-protect.sh')).toBeGreaterThan(idx('destructive-command-guard.sh'))
    expect(idx('plan-approval-guard.sh')).toBeGreaterThan(idx('bd-remember-protect.sh'))
    expect(idx('bd-create-gate.sh')).toBeGreaterThan(idx('plan-approval-guard.sh'))
    expect(idx('oisin-dev hook block-coauthor')).toBeGreaterThan(idx('bd-create-gate.sh'))

    // swarm-digest.sh registered on Stop
    const stopCmds = settings.hooks.Stop.flatMap((e) => e.hooks.map((h) => h.command))
    expect(stopCmds.some((c) => c.includes('swarm-digest.sh'))).toBe(true)
  })

  it('omits planning-gate hooks/skill/rules when beads is NOT selected', async () => {
    const noBeadsConfig: DevConfig = {
      ...fakeConfig,
      tools: ['contract-driven'],
      workflow: 'none',
    }
    const noBeadsAnswers: Answers = {
      ...fakeAnswers,
      tools: ['contract-driven'],
      workflow: 'none',
    }
    await installAll(dir, noBeadsConfig, noBeadsAnswers, { skipSideEffects: true })

    // Skill not shipped
    expect(existsSync(join(dir, '.claude/skills/plan-brief'))).toBe(false)
    // Rules not shipped
    expect(existsSync(join(dir, '.claude/rules/dsl.md'))).toBe(false)
    expect(existsSync(join(dir, '.claude/rules/tracer-bullet.md'))).toBe(false)
    expect(existsSync(join(dir, '.claude/rules/plan-brief-flow.md'))).toBe(false)
    // Slash commands not shipped
    expect(existsSync(join(dir, '.claude/commands/approve.md'))).toBe(false)

    // settings.json has no plan-approval-guard.sh in the Bash chain
    const settings = JSON.parse(readFileSync(join(dir, '.claude/settings.json'), 'utf8')) as {
      hooks: { PreToolUse: Array<{ matcher?: string; hooks: Array<{ command: string }> }> }
    }
    const bashMatcher = settings.hooks.PreToolUse.find((e) => e.matcher === 'Bash')
    const cmds = (bashMatcher?.hooks ?? []).map((h) => h.command)
    expect(cmds.some((c) => c.includes('plan-approval-guard.sh'))).toBe(false)
    expect(cmds.some((c) => c.includes('bd-create-gate.sh'))).toBe(false)
    expect(cmds.some((c) => c.includes('bd-remember-protect.sh'))).toBe(false)
  })

  it('rule files with paths frontmatter land in .claude/rules/ when the skill is selected', async () => {
    const frontendAnswers: Answers = {
      ...fakeAnswers,
      language: 'typescript',
      variant: 'ts-frontend',
      framework: 'react',
      packageManager: 'bun',
      skills: [
        'code-quality',
        'architecture',
        'testing',
        'ai-behavior',
        'component-patterns',
        'styling-ui',
      ],
    }
    const frontendConfig: DevConfig = {
      language: 'typescript',
      variant: 'ts-frontend',
      framework: 'react',
      packageManager: 'bun',
      commands: frontendAnswers.commands,
      skills: frontendAnswers.skills,
      tools: frontendAnswers.tools,
      workflow: frontendAnswers.workflow,
      contractDriven: frontendAnswers.contractDriven,
      targets: frontendAnswers.targets,
    }
    await installAll(dir, frontendConfig, frontendAnswers, { skipSideEffects: true })

    const componentRule = readFileSync(join(dir, '.claude/rules/component-patterns.md'), 'utf8')
    expect(componentRule).toContain('paths:')
    expect(componentRule).toContain('"**/*.tsx"')

    const codeQuality = readFileSync(join(dir, '.claude/rules/code-quality.md'), 'utf8')
    // code-quality, performance, testing are now path-scoped to source-shaped files
    // — they only inject when matching code is actually being read or edited (r4c).
    expect(codeQuality).toContain('paths:')
    expect(codeQuality).toContain('"**/*.ts"')
    expect(codeQuality).toContain('name: code-quality')
  })

  it('merges into existing CLAUDE.md without wiping user content', async () => {
    const { writeFileSync } = await import('node:fs')
    const existing = '# My existing notes\n\nSome important context I wrote.\n'
    writeFileSync(join(dir, 'CLAUDE.md'), existing)

    await installAll(dir, fakeConfig, fakeAnswers, { skipSideEffects: true })

    const merged = readFileSync(join(dir, 'CLAUDE.md'), 'utf8')
    expect(merged).toContain('My existing notes')
    expect(merged).toContain('Some important context')
    expect(merged).toContain('BEGIN @oisincoveney/dev managed block')
  })

  it('rewrites managed block on re-run without duplicating', async () => {
    const { writeFileSync } = await import('node:fs')
    // First install
    await installAll(dir, fakeConfig, fakeAnswers, { skipSideEffects: true })
    const first = readFileSync(join(dir, 'CLAUDE.md'), 'utf8')

    // Modify content outside managed block
    writeFileSync(
      join(dir, 'CLAUDE.md'),
      `${first}\n\n## My extra section\n\nUser-added content.`,
    )

    // Re-run
    await installAll(dir, fakeConfig, fakeAnswers, { skipSideEffects: true })
    const second = readFileSync(join(dir, 'CLAUDE.md'), 'utf8')

    // Managed block should appear exactly once
    const matches = second.match(/BEGIN @oisincoveney\/dev/g)
    expect(matches?.length).toBe(1)
    // User-added content preserved
    expect(second).toContain('My extra section')
  })

  it('collapses pre-existing duplicate managed blocks on merge', () => {
    // CLAUDE.md files in the wild can have 2+ managed blocks because earlier
    // installer versions appended instead of replacing. Update should leave
    // exactly one block.
    const start = '<!-- BEGIN @oisincoveney/dev managed block -->'
    const end = '<!-- END @oisincoveney/dev managed block -->'
    const dupe = `${start}\nold content v1\n${end}\n\n# user notes\n\n${start}\nold content v2\n${end}\n`

    const merged = mergeManagedBlock(dupe, 'fresh content')

    const startCount = (merged.match(/BEGIN @oisincoveney\/dev/g) ?? []).length
    expect(startCount).toBe(1)
    expect(merged).toContain('fresh content')
    expect(merged).not.toContain('old content v1')
    expect(merged).not.toContain('old content v2')
    expect(merged).toContain('# user notes')
  })

  it('prunes orphaned `bd prime` SessionStart hook on settings merge', () => {
    // Beads marketplace plugin provides its own SessionStart `bd prime` hook;
    // older harness versions also wrote one to project settings, so bd prime
    // fired twice (~3K tokens per cold start). Update should drop the
    // project-level entry.
    const existing = {
      hooks: {
        SessionStart: [
          {
            hooks: [{ type: 'command', command: 'bd prime' }],
            matcher: '',
          },
        ],
      },
    }
    const generated = {
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: 'command',
                command:
                  'cd "$(git rev-parse --show-toplevel)" && .claude/hooks/context-bootstrap.sh',
              },
            ],
          },
        ],
      },
    }

    const merged = mergeClaudeSettings(existing, generated) as {
      hooks: { SessionStart: { hooks: { command: string }[] }[] }
    }

    const allCommands = merged.hooks.SessionStart.flatMap((entry) =>
      entry.hooks.map((h) => h.command),
    )
    expect(allCommands.some((c) => c.trim() === 'bd prime')).toBe(false)
    expect(allCommands.some((c) => c.includes('context-bootstrap.sh'))).toBe(true)
  })

  it('prunes orphaned `bd prime` PreCompact hook on settings merge', () => {
    // Same dedupe story as SessionStart: the beads marketplace plugin owns the
    // PreCompact `bd prime` hook, so the harness must drop any project-level
    // bd prime registration left behind by older versions.
    const existing = {
      hooks: {
        PreCompact: [
          {
            hooks: [{ type: 'command', command: 'bd prime' }],
            matcher: '',
          },
        ],
      },
    }
    const generated = {
      hooks: {
        PreCompact: [
          {
            hooks: [
              {
                type: 'command',
                command:
                  'cd "$(git rev-parse --show-toplevel)" && .claude/hooks/pre-compact-prime.sh',
              },
            ],
          },
        ],
      },
    }

    const merged = mergeClaudeSettings(existing, generated) as {
      hooks: { PreCompact: { hooks: { command: string }[] }[] }
    }

    const allCommands = merged.hooks.PreCompact.flatMap((entry) =>
      entry.hooks.map((h) => h.command),
    )
    expect(allCommands.some((c) => c.trim() === 'bd prime')).toBe(false)
    expect(allCommands.some((c) => c.includes('pre-compact-prime.sh'))).toBe(true)
  })

  it('backs up existing lint configs to .user-backup before overwriting (manifest .user-backup, not legacy .dev-backup)', async () => {
    const { writeFileSync } = await import('node:fs')
    const customClippy = '# my custom clippy config\ncognitive-complexity-threshold = 999\n'
    writeFileSync(join(dir, 'clippy.toml'), customClippy)

    await installAll(dir, fakeConfig, fakeAnswers, { skipSideEffects: true })

    expect(existsSync(join(dir, 'clippy.toml.user-backup'))).toBe(true)
    const backup = readFileSync(join(dir, 'clippy.toml.user-backup'), 'utf8')
    expect(backup).toBe(customClippy)
    expect(existsSync(join(dir, 'clippy.toml.dev-backup'))).toBe(false)
  })

  it('writes correct files for a swift-app project (Pinny-style)', async () => {
    const swiftAnswers: Answers = {
      language: 'swift',
      variant: 'swift-app',
      framework: 'swiftui',
      packageManager: 'swift',
      commands: {
        dev: '',
        build: 'xcodebuild build',
        test: 'xcodebuild test',
        typecheck: 'xcodebuild build',
        lint: 'swiftlint lint',
        format: 'swiftformat .',
      },
      skills: ['code-quality', 'architecture', 'testing', 'ai-behavior', 'performance'],
      tools: ['beads'],
      workflow: 'bd',
      contractDriven: false,
      targets: ['claude', 'codex', 'opencode', 'cursor', 'lefthook'],
      mcpServers: [],
      models: {
        default: 'claude-sonnet-4-6',
        planning: 'claude-opus-4-6',
        simple_edits: 'claude-haiku-4-5-20251001',
        review: 'claude-opus-4-6',
      },
    }
    const swiftConfig: DevConfig = {
      language: swiftAnswers.language,
      variant: swiftAnswers.variant,
      framework: swiftAnswers.framework,
      packageManager: swiftAnswers.packageManager,
      commands: swiftAnswers.commands,
      skills: swiftAnswers.skills,
      tools: swiftAnswers.tools,
      workflow: swiftAnswers.workflow,
      contractDriven: swiftAnswers.contractDriven,
      targets: swiftAnswers.targets,
    }

    await installAll(dir, swiftConfig, swiftAnswers, { skipSideEffects: true })

    // Core hooks and settings present
    expect(existsSync(join(dir, '.claude/hooks/destructive-command-guard.sh'))).toBe(true)
    expect(existsSync(join(dir, '.claude/hooks/tdd-guard.sh'))).toBe(true)
    expect(existsSync(join(dir, '.claude/settings.json'))).toBe(true)

    // Lefthook generated with no ts-style-guard
    expect(existsSync(join(dir, 'lefthook.yml'))).toBe(true)
    const lefthook = readFileSync(join(dir, 'lefthook.yml'), 'utf8')
    expect(lefthook).not.toContain('ts-style-guard')
    expect(lefthook).toContain('xcodebuild test')
    expect(lefthook).toContain('swiftlint lint')

    // No TS-specific lint configs
    expect(existsSync(join(dir, 'tsconfig.strict.json'))).toBe(false)
    expect(existsSync(join(dir, 'clippy.toml'))).toBe(false)

    // Cursor rules use swift glob
    const codeQuality = readFileSync(join(dir, '.cursor/rules/code-quality.mdc'), 'utf8')
    expect(codeQuality).toContain('**/*.swift')

    // No scaffolding for swift-app — Xcode project structure is opaque
    expect(existsSync(join(dir, 'Sources/Example/Example.swift'))).toBe(false)
    expect(existsSync(join(dir, 'Tests/PropertyExampleTests/PropertyExampleTests.swift'))).toBe(false)
    expect(existsSync(join(dir, 'Sources/Logging/Logging.swift'))).toBe(false)

    // Commands written to the new rules dir
    const commands = readFileSync(join(dir, '.claude/rules/commands.md'), 'utf8')
    expect(commands).toContain('xcodebuild build')
    expect(commands).toContain('swiftlint lint')

    // CLAUDE.md is the new kernel — no @imports
    const claude = readFileSync(join(dir, 'CLAUDE.md'), 'utf8')
    expect(claude).not.toContain('@.claude/docs/')
    expect(claude).toContain('.claude/rules/')
  })

  it('does not create .cursor or .codex when not in targets', async () => {
    const minimal: DevConfig = {
      ...fakeConfig,
      targets: ['claude'],
    }
    await installAll(dir, minimal, fakeAnswers, { skipSideEffects: true })
    expect(existsSync(join(dir, '.cursor'))).toBe(false)
    expect(existsSync(join(dir, '.codex'))).toBe(false)
    expect(existsSync(join(dir, '.claude'))).toBe(true)
  })

  describe('with all commands null (other-app path)', () => {
    const otherConfig: DevConfig = {
      ...fakeConfig,
      language: 'other',
      variant: 'other-app',
      packageManager: 'other',
      commands: {
        dev: null,
        build: null,
        test: null,
        typecheck: null,
        lint: null,
        format: null,
      },
    }
    const otherAnswers: Answers = {
      ...fakeAnswers,
      language: 'other',
      variant: 'other-app',
      packageManager: 'other',
      commands: otherConfig.commands,
    }

    it('commands.md emits the "not set yet" stub', async () => {
      await installAll(dir, otherConfig, otherAnswers, { skipSideEffects: true })
      const commands = readFileSync(join(dir, '.claude/rules/commands.md'), 'utf8')
      expect(commands).toContain('Commands are not set yet')
      expect(commands).toContain('oisin-dev set-commands')
      expect(commands).not.toMatch(/^dev:\s*$/m)
      expect(commands).not.toMatch(/^test:\s*$/m)
    })

    it('lefthook.yml has no empty `run:` lines and omits command-dependent steps', async () => {
      await installAll(dir, otherConfig, otherAnswers, { skipSideEffects: true })
      const lefthook = readFileSync(join(dir, 'lefthook.yml'), 'utf8')
      expect(lefthook).not.toMatch(/^\s*run:\s*$/m)
      expect(lefthook).not.toContain('run: \n')
      expect(lefthook).not.toMatch(/typecheck:\s*\n\s*run:\s*\n/)
      expect(lefthook).not.toMatch(/lint:\s*\n\s*run:\s*\n/)
      expect(lefthook).not.toMatch(/^\s{4}test:\s*\n\s*run:\s*\n/m)
      expect(lefthook).toContain('tdd-guard')
      expect(lefthook).toContain('pr-size-check')
      expect(lefthook).toContain('conventional-commits')
    })

    it('claude settings Bash allow rule has no empty alternatives', async () => {
      await installAll(dir, otherConfig, otherAnswers, { skipSideEffects: true })
      const raw = readFileSync(join(dir, '.claude/settings.json'), 'utf8')
      const parsed = JSON.parse(raw) as {
        permissions: { rules: Array<{ tool: string; decision: string; if?: string }> }
      }
      const allowRules = parsed.permissions.rules.filter(
        (r) => r.tool === 'Bash' && r.decision === 'allow' && r.if !== undefined,
      )
      for (const rule of allowRules) {
        expect(rule.if).not.toMatch(/\|\|/)
        expect(rule.if).not.toMatch(/\(\|/)
        expect(rule.if).not.toMatch(/\|\)/)
      }
      const verificationRule = allowRules.find((r) => r.if?.includes('git status'))
      expect(verificationRule).toBeDefined()
      expect(verificationRule?.if).toBe('Bash(git status|git diff|git log|bd *)')
    })
  })
})

describe('legacy migration helpers (0.6.5 → 0.8.x)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'migrate-test-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('removeLegacyRetiredPaths removes .claude/commands/spec.md', () => {
    mkdirSync(join(dir, '.claude/commands'), { recursive: true })
    writeFileSync(join(dir, '.claude/commands/spec.md'), 'legacy')
    const r = removeLegacyRetiredPaths(dir)
    expect(existsSync(join(dir, '.claude/commands/spec.md'))).toBe(false)
    expect(r.removed).toContain('.claude/commands/spec.md')
  })

  it('removeLegacyRetiredPaths removes .claude/specs/TEMPLATE.md and the empty parent dir', () => {
    mkdirSync(join(dir, '.claude/specs'), { recursive: true })
    writeFileSync(join(dir, '.claude/specs/TEMPLATE.md'), 'legacy template')
    const r = removeLegacyRetiredPaths(dir)
    expect(existsSync(join(dir, '.claude/specs/TEMPLATE.md'))).toBe(false)
    expect(existsSync(join(dir, '.claude/specs'))).toBe(false)
    expect(r.removed).toContain('.claude/specs/TEMPLATE.md')
    expect(r.removed).toContain('.claude/specs/ (empty)')
  })

  it('warns instead of deleting when .claude/specs has user-authored markdown', () => {
    mkdirSync(join(dir, '.claude/specs'), { recursive: true })
    writeFileSync(join(dir, '.claude/specs/TEMPLATE.md'), 'legacy')
    writeFileSync(join(dir, '.claude/specs/2026-01-01-feature.md'), 'user spec')
    const r = removeLegacyRetiredPaths(dir)
    expect(r.removed).toContain('.claude/specs/TEMPLATE.md')
    expect(existsSync(join(dir, '.claude/specs'))).toBe(true)
    expect(r.warnings.some((w: string) => w.includes('2026-01-01-feature.md'))).toBe(true)
  })

  it('warns about non-empty .claude/plans/ and docs/research/', () => {
    mkdirSync(join(dir, '.claude/plans'), { recursive: true })
    writeFileSync(join(dir, '.claude/plans/x.md'), 'plan')
    mkdirSync(join(dir, 'docs/research'), { recursive: true })
    writeFileSync(join(dir, 'docs/research/y.md'), 'dossier')
    const r = removeLegacyRetiredPaths(dir)
    expect(r.warnings.some((w: string) => w.includes('.claude/plans'))).toBe(true)
    expect(r.warnings.some((w: string) => w.includes('docs/research'))).toBe(true)
    expect(existsSync(join(dir, '.claude/plans/x.md'))).toBe(true)
    expect(existsSync(join(dir, 'docs/research/y.md'))).toBe(true)
  })

  it('trimBeadsIntegrationOnAgentDocs trims AGENTS.md and CLAUDE.md', () => {
    const dirty = `<!-- BEGIN BEADS INTEGRATION v:1 -->
## Beads Issue Tracker

### Quick Reference
some content

## Session Completion

**MANDATORY**: push to remote.

1. PUSH TO REMOTE
<!-- END BEADS INTEGRATION -->
`
    writeFileSync(join(dir, 'AGENTS.md'), dirty)
    writeFileSync(join(dir, 'CLAUDE.md'), dirty)
    const trimmed = trimBeadsIntegrationOnAgentDocs(dir)
    expect(trimmed).toContain('AGENTS.md')
    expect(trimmed).toContain('CLAUDE.md')
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).not.toContain('Session Completion')
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).not.toContain('Session Completion')
  })

  it('stripLegacyConfigFields removes enforcement / beadsWorkflow / mcp from .dev.config.json', () => {
    const stale = {
      language: 'typescript',
      enforcement: { baselinePin: true, docsFirst: false },
      beadsWorkflow: { requireClaim: true },
      mcp: { context7: true },
      tools: ['beads'],
    }
    writeFileSync(join(dir, '.dev.config.json'), JSON.stringify(stale, null, 2))
    const stripped = stripLegacyConfigFields(dir)
    expect(stripped).toEqual(expect.arrayContaining(['enforcement', 'beadsWorkflow', 'mcp']))
    const after = JSON.parse(readFileSync(join(dir, '.dev.config.json'), 'utf8'))
    expect(after.enforcement).toBeUndefined()
    expect(after.beadsWorkflow).toBeUndefined()
    expect(after.mcp).toBeUndefined()
    expect(after.tools).toEqual(['beads'])
  })

  it('helpers are idempotent — second run is a no-op', () => {
    mkdirSync(join(dir, '.claude/commands'), { recursive: true })
    writeFileSync(join(dir, '.claude/commands/spec.md'), 'legacy')
    removeLegacyRetiredPaths(dir)
    const second = removeLegacyRetiredPaths(dir)
    expect(second.removed).toEqual([])
    expect(second.warnings).toEqual([])
    expect(stripLegacyConfigFields(dir)).toEqual([])
    expect(trimBeadsIntegrationOnAgentDocs(dir)).toEqual([])
  })
})
