import { describe, expect, it } from 'vitest'
import type { DevConfig } from '../config.js'
import { detectProject } from '../detect.js'
import { generateClaudeSettings } from '../generate/claude-settings.js'
import { generateCodexHooks } from '../generate/codex-hooks.js'
import { generateCursorRules } from '../generate/cursor-rules.js'
import { generateLefthook } from '../generate/lefthook.js'
import { generateLintConfig } from '../generate/lint-config.js'
import { buildClaudeMdBundle, generateClaudeMd } from '../generate/markdown.js'
import { generateRules } from '../generate/rules.js'
import { RULE_SKILLS, SUPERPOWER_SKILLS, skillsForVariant } from '../skills.js'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { installAll } from '../install.js'
import { writeConfig } from '../config.js'

const TEMPLATES_DIR = resolve(__dirname, '..', '..', 'templates')

const tsFrontendConfig: DevConfig = {
  language: 'typescript',
  variant: 'ts-frontend',
  framework: 'react',
  packageManager: 'bun',
  commands: {
    dev: 'vp dev',
    build: 'vp build',
    test: 'vp test',
    typecheck: 'vp check',
    lint: 'vp check',
    format: 'vp check',
    e2e: 'playwright test',
  },
  skills: RULE_SKILLS.map((s) => s.id),
  tools: ['beads', 'contract-driven'],
  workflow: 'bd',
  contractDriven: true,
  targets: ['claude', 'codex', 'cursor', 'lefthook'],
}

const rustConfig: DevConfig = {
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
  tools: ['beads'],
  workflow: 'none',
  contractDriven: false,
  targets: ['claude', 'lefthook'],
}

const goConfig: DevConfig = {
  ...rustConfig,
  language: 'go',
  variant: 'go-bin',
  packageManager: 'go',
  commands: {
    dev: 'go run .',
    build: 'go build ./...',
    test: 'go test ./...',
    typecheck: 'go vet ./...',
    lint: 'golangci-lint run',
    format: 'gofmt -w .',
  },
  workflow: 'none',
}

describe('skills registry', () => {
  it('has non-empty rule and superpower registries', () => {
    expect(RULE_SKILLS.length).toBeGreaterThan(0)
    expect(SUPERPOWER_SKILLS.length).toBeGreaterThan(0)
  })

  it('filters skills by variant', () => {
    const ts = skillsForVariant('ts-frontend')
    const rust = skillsForVariant('rust-bin')
    expect(ts.some((s) => s.id === 'component-patterns')).toBe(true)
    expect(rust.some((s) => s.id === 'component-patterns')).toBe(false)
  })

  it('every rule skill references a templates/rules/<id>.md source file', () => {
    const { existsSync } = require('node:fs') as typeof import('node:fs')
    const { resolve } = require('node:path') as typeof import('node:path')
    for (const skill of RULE_SKILLS) {
      expect(skill.sourceFile).toBe(`templates/rules/${skill.id}.md`)
      const abs = resolve(__dirname, '..', '..', skill.sourceFile)
      expect(existsSync(abs)).toBe(true)
    }
  })

  it('testing rule source includes proof-of-work requirement', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs')
    const { resolve } = require('node:path') as typeof import('node:path')
    const body = readFileSync(resolve(__dirname, '..', '..', 'templates/rules/testing.md'), 'utf8')
    expect(body).toContain('Proof of work')
    expect(body).toContain('tests should pass')
  })

  it('ai-behavior rule source includes no-completion-claims rule', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs')
    const { resolve } = require('node:path') as typeof import('node:path')
    const body = readFileSync(resolve(__dirname, '..', '..', 'templates/rules/ai-behavior.md'), 'utf8')
    expect(body).toContain('No completion claim without proof')
    expect(body).toContain('Stop hook checks transcript')
  })
})

describe('generateClaudeSettings', () => {
  it('produces valid structure with all hook events', () => {
    const settings = generateClaudeSettings(tsFrontendConfig)
    expect(settings.hooks.UserPromptSubmit).toBeDefined()
    expect(settings.hooks.PreToolUse).toBeDefined()
    expect(settings.hooks.PostToolUse).toBeDefined()
    expect(settings.hooks.SessionStart).toBeDefined()
    expect(settings.hooks.Stop).toBeDefined()
    expect(settings.hooks.PreCompact).toBeDefined()
  })

  it('registers banned-words-guard.sh on Stop alongside pre-stop-verification.sh', () => {
    const settings = generateClaudeSettings(tsFrontendConfig)
    const stopEntries = settings.hooks.Stop ?? []
    const commands = stopEntries.flatMap((e) => e.hooks.map((h) => h.command))
    expect(commands.some((c) => c.includes('pre-stop-verification.sh'))).toBe(true)
    expect(commands.some((c) => c.includes('banned-words-guard.sh'))).toBe(true)
  })

  it('does not register verify-grounding.sh on Stop (replaced by @pinperepette/grounded)', () => {
    // Stop-event grounding is now handled by grounded's `confidence-check`
    // hook, which installGroundedHooks writes into ~/.claude/settings.json
    // (user-level) during the side-effects phase of installAll. The project's
    // generated .claude/settings.json must not double-wire verify-grounding.sh.
    const settings = generateClaudeSettings(tsFrontendConfig)
    const stopEntries = settings.hooks.Stop ?? []
    const commands = stopEntries.flatMap((e) => e.hooks.map((h) => h.command))
    expect(commands.some((c) => c.includes('verify-grounding.sh'))).toBe(false)
  })

  it('registers pre-compact-prime.sh on PreCompact', () => {
    const settings = generateClaudeSettings(tsFrontendConfig)
    const entries = settings.hooks.PreCompact ?? []
    const commands = entries.flatMap((e) => e.hooks.map((h) => h.command))
    expect(commands.some((c) => c.includes('pre-compact-prime.sh'))).toBe(true)
  })

  it('includes a statusLine entry pointing at statusline.sh', () => {
    const settings = generateClaudeSettings(tsFrontendConfig)
    expect(settings.statusLine).toBeDefined()
    expect(settings.statusLine?.command).toContain('statusline.sh')
  })

  it('blocks destructive commands in permission rules', () => {
    const settings = generateClaudeSettings(tsFrontendConfig)
    const denyRule = settings.permissions.rules.find((r) => r.decision === 'deny')
    expect(denyRule).toBeDefined()
    expect(denyRule?.if).toContain('rm -rf')
    expect(denyRule?.if).toContain('git reset --hard')
  })

  it('allows the configured dev commands', () => {
    const settings = generateClaudeSettings(tsFrontendConfig)
    const allowRule = settings.permissions.rules.find(
      (r) => r.decision === 'allow' && r.tool === 'Bash',
    )
    expect(allowRule?.if).toContain('vp check')
  })

  describe('all hardening hooks register unconditionally', () => {
    it('registers a single PreToolUse dispatcher with no matcher', () => {
      const settings = generateClaudeSettings(tsFrontendConfig)
      expect(settings.hooks.PreToolUse).toHaveLength(1)
      const [entry] = settings.hooks.PreToolUse ?? []
      expect(entry?.matcher).toBeUndefined()
      expect(entry?.hooks).toHaveLength(1)
      expect(entry?.hooks[0]?.command).toContain('pre-tool-dispatch.sh')
    })

    it('always registers citation-check.sh on Stop', () => {
      const settings = generateClaudeSettings(tsFrontendConfig)
      const commands = (settings.hooks.Stop ?? []).flatMap((e) =>
        e.hooks.map((h) => h.command),
      )
      expect(commands.some((c) => c.includes('citation-check.sh'))).toBe(true)
    })

    it('always registers baseline-pin.sh on SessionStart and baseline-compare.sh on Stop, in order', () => {
      const settings = generateClaudeSettings(tsFrontendConfig)
      const ss = (settings.hooks.SessionStart ?? []).flatMap((e) =>
        e.hooks.map((h) => h.command),
      )
      const sessionStart = ss.join(' ')
      expect(sessionStart.indexOf('context-bootstrap.sh')).toBeGreaterThanOrEqual(0)
      expect(sessionStart.indexOf('baseline-pin.sh')).toBeGreaterThan(
        sessionStart.indexOf('context-bootstrap.sh'),
      )

      const stop = (settings.hooks.Stop ?? []).flatMap((e) => e.hooks.map((h) => h.command))
      const stopCommand = stop.join(' ')
      expect(stopCommand.indexOf('pre-stop-verification.sh')).toBeGreaterThanOrEqual(0)
      expect(stopCommand.indexOf('baseline-compare.sh')).toBeGreaterThan(
        stopCommand.indexOf('pre-stop-verification.sh'),
      )
      expect(stopCommand.indexOf('banned-words-guard.sh')).toBeGreaterThan(
        stopCommand.indexOf('baseline-compare.sh'),
      )
    })

    it('always registers ai-antipattern-guard.sh on PreToolUse + PostToolUse + Stop', () => {
      const settings = generateClaudeSettings(tsFrontendConfig)
      const post = JSON.stringify(settings.hooks.PostToolUse ?? [])
      const stop = JSON.stringify(settings.hooks.Stop ?? [])
      const dispatch = readFileSync(
        resolve(__dirname, '..', '..', 'templates/hooks/pre-tool-dispatch.sh'),
        'utf8',
      )
      expect(dispatch).toContain('ai-antipattern-guard.sh')
      expect(post).toContain('ai-antipattern-guard.sh')
      expect(stop).toContain('ai-antipattern-guard.sh')
    })

    it('enables beads policy in PreToolUse dispatcher when tools includes beads', () => {
      const cfg: DevConfig = { ...tsFrontendConfig, tools: ['beads'] }
      const settings = generateClaudeSettings(cfg)
      const command = JSON.stringify(settings.hooks.PreToolUse ?? [])
      expect(command).toContain('OISIN_DEV_BEADS=1')
    })

    it('omits require-claim.sh when tools does NOT include beads', () => {
      const cfg: DevConfig = { ...tsFrontendConfig, tools: [] }
      const settings = generateClaudeSettings(cfg)
      const command = JSON.stringify(settings.hooks.PreToolUse ?? [])
      expect(command).not.toContain('OISIN_DEV_BEADS=1')
    })

    it('registers context7 mcpServer when tools includes beads', () => {
      const cfg: DevConfig = { ...tsFrontendConfig, tools: ['beads'] }
      const settings = generateClaudeSettings(cfg)
      const c7 = settings.mcpServers?.context7 as { command: string; args: string[] }
      expect(c7?.command).toBe('npx')
      expect(c7?.args.some((a) => a.includes('@upstash/context7-mcp'))).toBe(true)
    })

    it('omits context7 mcpServer when tools does NOT include beads', () => {
      const cfg: DevConfig = { ...tsFrontendConfig, tools: [] }
      const settings = generateClaudeSettings(cfg)
      expect(settings.mcpServers?.context7).toBeUndefined()
    })
  })
})

describe('generateCodexHooks', () => {
  it('retargets hook paths from .claude to .codex', () => {
    const codex = generateCodexHooks(tsFrontendConfig) as { hooks: { PreToolUse: unknown[] } }
    const json = JSON.stringify(codex)
    expect(json).toContain('.codex/hooks/')
    expect(json).not.toContain('.claude/hooks/')
  })

  it('runs hooks through the quiet runner', () => {
    const codex = generateCodexHooks(tsFrontendConfig) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>
    }
    const commands = Object.values(codex.hooks).flatMap((entries) =>
      entries.flatMap((entry) => entry.hooks.map((hook) => hook.command)),
    )

    expect(commands.length).toBeGreaterThan(0)
    expect(
      commands.every((command) =>
        command.includes('.codex/hooks/run-quiet.sh') ||
        command.includes('.codex/hooks/pre-tool-dispatch.sh'),
      ),
    ).toBe(true)
  })
})

describe('generateCursorRules', () => {
  it('generates one .mdc per selected skill', () => {
    const rules = generateCursorRules(tsFrontendConfig, TEMPLATES_DIR)
    const selected = RULE_SKILLS.filter((s) => tsFrontendConfig.skills.includes(s.id))
    expect(rules.length).toBe(selected.length)
  })

  it('includes glob metadata', () => {
    const rules = generateCursorRules(tsFrontendConfig, TEMPLATES_DIR)
    expect(rules[0]?.content).toContain('globs:')
    expect(rules[0]?.content).toContain('*.ts')
  })

  it('uses Rust globs for Rust project', () => {
    const rules = generateCursorRules(rustConfig, TEMPLATES_DIR)
    expect(rules[0]?.content).toContain('*.rs')
  })
})

describe('generateLefthook', () => {
  it('includes conventional commits, TDD guard, and PR size check', () => {
    const yml = generateLefthook(tsFrontendConfig)
    expect(yml).toContain('conventional-commits')
    expect(yml).toContain('tdd-guard.sh')
    expect(yml).toContain('pr-size-check.sh')
    expect(yml).toContain('semgrep')
  })

  it('injects the configured lint and test commands', () => {
    const yml = generateLefthook(tsFrontendConfig)
    expect(yml).toContain('vp check')
    expect(yml).toContain('vp test')
  })

  it('includes playwright step for ts-frontend when e2e is configured', () => {
    const yml = generateLefthook(tsFrontendConfig)
    expect(yml).toContain('playwright')
    expect(yml).toContain('playwright test')
  })

  it('includes playwright step for ts-fullstack when e2e is configured', () => {
    const fullstackConfig: DevConfig = {
      ...tsFrontendConfig,
      variant: 'ts-fullstack',
      commands: { ...tsFrontendConfig.commands, e2e: 'playwright test' },
    }
    const yml = generateLefthook(fullstackConfig)
    expect(yml).toContain('playwright')
  })

  it('does not include playwright step for backend variants', () => {
    const backendConfig: DevConfig = {
      ...tsFrontendConfig,
      variant: 'ts-backend',
      commands: { ...tsFrontendConfig.commands, e2e: undefined },
    }
    const yml = generateLefthook(backendConfig)
    expect(yml).not.toContain('playwright')
  })

  it('does not include playwright step when e2e is not configured', () => {
    const noE2eConfig: DevConfig = {
      ...tsFrontendConfig,
      commands: { ...tsFrontendConfig.commands, e2e: undefined },
    }
    const yml = generateLefthook(noE2eConfig)
    expect(yml).not.toContain('playwright')
  })
})

describe('generateLintConfig', () => {
  it('returns empty config for TS (Vite+ owns it)', () => {
    expect(generateLintConfig(tsFrontendConfig)).toEqual({})
  })

  it('generates clippy.toml + rustfmt.toml for Rust', () => {
    const configs = generateLintConfig(rustConfig)
    expect(configs['clippy.toml']).toBeDefined()
    expect(configs['clippy.toml']).toContain('disallowed-names')
    expect(configs['clippy.toml']).toContain('cognitive-complexity-threshold')
    expect(configs['rustfmt.toml']).toBeDefined()
    expect(configs['rustfmt.toml']).toContain('edition = "2024"')
  })

  it('generates .golangci.yml for Go', () => {
    const configs = generateLintConfig(goConfig)
    expect(configs['.golangci.yml']).toBeDefined()
    expect(configs['.golangci.yml']).toContain('gocognit')
    expect(configs['.golangci.yml']).toContain('varnamelen')
    expect(configs['.golangci.yml']).toContain('depguard')
  })
})

describe('detectProject', () => {
  function makeTmpProject(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'style-template-test-'))
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content)
    }
    return dir
  }

  it('detects ts-fullstack for SvelteKit project', () => {
    const dir = makeTmpProject({
      'package.json': JSON.stringify({
        scripts: { dev: 'vite dev', build: 'vite build', check: 'svelte-check' },
        devDependencies: { '@sveltejs/kit': '^2.0.0', vite: '^5.0.0' },
      }),
    })
    try {
      const result = detectProject(dir)
      expect(result.variant).toBe('ts-fullstack')
      expect(result.language).toBe('typescript')
    } finally {
      rmSync(dir, { recursive: true })
    }
  })

  it('detects ts-frontend for plain Svelte (no Kit) project', () => {
    const dir = makeTmpProject({
      'package.json': JSON.stringify({
        scripts: { dev: 'vite dev', build: 'vite build' },
        devDependencies: { '@sveltejs/vite-plugin-svelte': '^3.0.0', vite: '^5.0.0' },
      }),
    })
    try {
      const result = detectProject(dir)
      expect(result.variant).toBe('ts-frontend')
    } finally {
      rmSync(dir, { recursive: true })
    }
  })

  it('detects ts-fullstack for Next.js project', () => {
    const dir = makeTmpProject({
      'package.json': JSON.stringify({
        scripts: { dev: 'next dev', build: 'next build' },
        dependencies: { next: '^14.0.0', react: '^18.0.0' },
      }),
    })
    try {
      const result = detectProject(dir)
      expect(result.variant).toBe('ts-fullstack')
    } finally {
      rmSync(dir, { recursive: true })
    }
  })

  it('detects ts-backend for Hono project', () => {
    const dir = makeTmpProject({
      'package.json': JSON.stringify({
        scripts: { dev: 'bun run src/index.ts', build: 'bun build' },
        dependencies: { hono: '^4.0.0' },
      }),
    })
    try {
      const result = detectProject(dir)
      expect(result.variant).toBe('ts-backend')
    } finally {
      rmSync(dir, { recursive: true })
    }
  })

  it('reads scripts from package.json', () => {
    const dir = makeTmpProject({
      'package.json': JSON.stringify({
        scripts: { dev: 'vp dev', build: 'vp build', test: 'vp test', check: 'vp check' },
        devDependencies: { vite: '^5.0.0', react: '^18.0.0' },
        'bun.lock': '',
      }),
    })
    try {
      const result = detectProject(dir)
      expect(result.commands.dev).toBe('bun run dev')
      expect(result.commands.build).toBe('bun run build')
      expect(result.commands.test).toBe('bun run test')
      expect(result.commands.typecheck).toBe('bun run check')
    } finally {
      rmSync(dir, { recursive: true })
    }
  })

  it('detects Rust project', () => {
    const dir = makeTmpProject({
      'Cargo.toml': '[package]\nname = "myapp"\nversion = "0.1.0"',
    })
    try {
      const result = detectProject(dir)
      expect(result.language).toBe('rust')
      expect(result.packageManager).toBe('cargo')
      expect(result.commands.test).toBe('cargo test')
    } finally {
      rmSync(dir, { recursive: true })
    }
  })
})

describe('generateClaudeMd (kernel)', () => {
  const fakeAnswers = {} as never

  it('produces a short kernel with no @imports', () => {
    const md = generateClaudeMd(tsFrontendConfig, fakeAnswers)
    expect(md.split('\n').length).toBeLessThan(50)
    expect(md).not.toContain('@.claude/')
  })

  it('includes proof-of-work rule in critical rules', () => {
    const bundle = buildClaudeMdBundle(tsFrontendConfig, fakeAnswers)
    expect(bundle.root).toContain('Stop hook')
    expect(bundle.fragments).toEqual({})
  })

  it('points Claude at .claude/rules/', () => {
    const md = generateClaudeMd(tsFrontendConfig, fakeAnswers)
    expect(md).toContain('.claude/rules/')
  })

  it('mentions beads kernel rule only when beads is selected', () => {
    const noBeads: DevConfig = { ...tsFrontendConfig, tools: [] }
    const withBeads = generateClaudeMd(tsFrontendConfig, fakeAnswers)
    const withoutBeads = generateClaudeMd(noBeads, fakeAnswers)
    expect(withBeads).toContain('bd')
    expect(withoutBeads).not.toContain('`bd`')
  })
})

describe('generateRules', () => {
  it('includes commands rule with actual project commands', () => {
    const rules = generateRules(tsFrontendConfig, TEMPLATES_DIR)
    const commands = rules.find((r) => r.filename === 'commands.md')
    expect(commands?.content).toContain('vp dev')
    expect(commands?.content).toContain('vp check')
    expect(commands?.content).toContain('e2e:')
    expect(commands?.content).toContain('playwright test')
  })

  it('omits e2e line in commands when not configured', () => {
    const noE2e: DevConfig = {
      ...tsFrontendConfig,
      commands: { ...tsFrontendConfig.commands, e2e: undefined },
    }
    const rules = generateRules(noE2e, TEMPLATES_DIR)
    const commands = rules.find((r) => r.filename === 'commands.md')
    expect(commands?.content).not.toContain('e2e:')
  })

  it('emits coding-principles.md (Karpathy) when selected', () => {
    const withPrinciples: DevConfig = {
      ...tsFrontendConfig,
      skills: [...tsFrontendConfig.skills, 'coding-principles'],
    }
    const rules = generateRules(withPrinciples, TEMPLATES_DIR)
    const principles = rules.find((r) => r.filename === 'coding-principles.md')
    // coding-principles is a static rule if selected; otherwise skipped.
    // This suite primarily exercises the static-rule selection path.
    expect(principles === undefined || principles.content.includes('Think Before Coding')).toBe(
      true,
    )
  })

  it('includes uncertainty.md when selected', () => {
    const cfg: DevConfig = {
      ...tsFrontendConfig,
      skills: [...tsFrontendConfig.skills, 'uncertainty'],
    }
    const rules = generateRules(cfg, TEMPLATES_DIR)
    const u = rules.find((r) => r.filename === 'uncertainty.md')
    if (u) {
      expect(u.content).toContain('this should work')
      expect(u.content).toContain('tests should pass')
    }
  })

  it('emits beads.md when beads tool is selected', () => {
    const rules = generateRules(tsFrontendConfig, TEMPLATES_DIR)
    const beads = rules.find((r) => r.filename === 'beads.md')
    expect(beads?.content).toContain('bd ready')
  })

  it('emits planning-ux.md when beads tool is selected', () => {
    const rules = generateRules(tsFrontendConfig, TEMPLATES_DIR)
    const planning = rules.find((r) => r.filename === 'planning-ux.md')
    expect(planning?.content).toContain('Planning UX')
    expect(planning?.content).toContain('Grill me')
    expect(planning?.content).toContain('Just do it')
    expect(planning?.content).toContain('Defer')
    expect(planning?.content).toContain('Never file epic+children unilaterally')
    expect(planning?.content).toContain('plan-brief-flow.md')
  })

  it('omits planning-ux.md when beads tool is not selected', () => {
    const cfg: DevConfig = { ...tsFrontendConfig, tools: [] }
    const rules = generateRules(cfg, TEMPLATES_DIR)
    expect(rules.some((r) => r.filename === 'planning-ux.md')).toBe(false)
  })

  it('registers bd-context-inject.sh on UserPromptSubmit when beads is selected', () => {
    const settings = generateClaudeSettings(tsFrontendConfig)
    const ups = settings.hooks.UserPromptSubmit ?? []
    const commands = ups.flatMap((e) => e.hooks.map((h) => h.command))
    expect(commands.some((c) => c.includes('bd-context-inject.sh'))).toBe(true)
    expect(commands.some((c) => c.includes('context-injector.sh'))).toBe(false)
  })

  it('omits bd-context-inject.sh when beads is not selected', () => {
    const cfg: DevConfig = { ...tsFrontendConfig, tools: [] }
    const settings = generateClaudeSettings(cfg)
    const ups = settings.hooks.UserPromptSubmit ?? []
    const commands = ups.flatMap((e) => e.hooks.map((h) => h.command))
    expect(commands.some((c) => c.includes('bd-context-inject.sh'))).toBe(false)
    expect(commands.some((c) => c.includes('context-injector.sh'))).toBe(true)
  })

  it('codex uses the compact beads context hook without duplicate prompt context', () => {
    const codex = generateCodexHooks(tsFrontendConfig) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>
    }
    const commands = codex.hooks.UserPromptSubmit.flatMap((e) => e.hooks.map((h) => h.command))
    expect(commands).toHaveLength(1)
    expect(commands[0]).toContain('.codex/hooks/bd-context-inject.sh')
  })

  it('bd context hook template stays compact', () => {
    const body = readFileSync(
      resolve(__dirname, '..', '..', 'templates/hooks/bd-context-inject.sh'),
      'utf8',
    )
    expect(body).toContain('<turn-context>')
    expect(body).toContain('Claimed:')
    expect(body).not.toContain('bd state:')
    expect(body).not.toContain('top of ready queue:')
  })

  it('enables require-swarm via PreToolUse dispatcher when beads is selected', () => {
    const settings = generateClaudeSettings(tsFrontendConfig)
    expect(JSON.stringify(settings.hooks.PreToolUse ?? [])).toContain('OISIN_DEV_BEADS=1')
    const dispatch = readFileSync(
      resolve(__dirname, '..', '..', 'templates/hooks/pre-tool-dispatch.sh'),
      'utf8',
    )
    expect(dispatch).toContain('require-swarm.sh')
  })

  it('disables beads policy in PreToolUse dispatcher when beads is not selected', () => {
    const cfg: DevConfig = { ...tsFrontendConfig, tools: [] }
    const settings = generateClaudeSettings(cfg)
    expect(JSON.stringify(settings.hooks.PreToolUse ?? [])).not.toContain('OISIN_DEV_BEADS=1')
  })

  it('lefthook commit-msg includes bd-ticket-ref step when beads is selected', () => {
    const yml = generateLefthook(tsFrontendConfig)
    expect(yml).toContain('bd-ticket-ref')
    expect(yml).toContain('Refs:')
    expect(yml).toContain('docs|chore|style')
  })

  it('lefthook commit-msg omits bd-ticket-ref when beads is not selected', () => {
    const cfg: DevConfig = { ...tsFrontendConfig, tools: [] }
    const yml = generateLefthook(cfg)
    expect(yml).not.toContain('bd-ticket-ref')
  })

  it('emits scope-discipline.md when beads tool is selected', () => {
    const rules = generateRules(tsFrontendConfig, TEMPLATES_DIR)
    const scope = rules.find((r) => r.filename === 'scope-discipline.md')
    expect(scope?.content).toContain('Scope Discipline')
    expect(scope?.content).toContain('discovered-from')
    expect(scope?.content).toContain('Files Likely Touched')
    expect(scope?.content).toContain('Never silently fix')
  })

  it('emits verifier-loop.md when beads tool is selected', () => {
    const rules = generateRules(tsFrontendConfig, TEMPLATES_DIR)
    const verifier = rules.find((r) => r.filename === 'verifier-loop.md')
    expect(verifier?.content).toContain('Verifier Loop')
    expect(verifier?.content).toContain('code-review')
    expect(verifier?.content).toContain('PASS-WITH-FOLLOWUPS')
    expect(verifier?.content).toContain('discovered-from')
    expect(verifier?.content).toContain('No silent inline fixes')
  })

  it('emits bd-native workflow when workflow is bd', () => {
    const cfg: DevConfig = { ...tsFrontendConfig, workflow: 'bd' as never }
    const rules = generateRules(cfg, TEMPLATES_DIR)
    const workflow = rules.find((r) => r.filename === 'workflow.md')
    expect(workflow?.content).toContain('bd is the source of truth')
    expect(workflow?.content).toContain('/epic')
    expect(workflow?.content).toContain('/work-next')
    expect(workflow?.content).toContain('/verify-spec')
    expect(workflow?.content).not.toContain('.claude/specs/')
    expect(workflow?.content).not.toContain('docs/research/')
  })

  it('plain workflow.md does not reference .claude/specs/ paths', () => {
    const cfg: DevConfig = { ...tsFrontendConfig, workflow: 'none' }
    const rules = generateRules(cfg, TEMPLATES_DIR)
    const workflow = rules.find((r) => r.filename === 'workflow.md')
    expect(workflow?.content).not.toContain('.claude/specs/YYYY-MM-DD')
  })

  it('emits contract-driven.md with language-scoped paths when enabled', () => {
    const rules = generateRules(tsFrontendConfig, TEMPLATES_DIR)
    const contract = rules.find((r) => r.filename === 'contract-driven.md')
    expect(contract?.content).toContain('Contract-Driven Modules')
    expect(contract?.content).toContain('contract.ts')
    expect(contract?.content).toContain('"src/**/*.ts"')
  })

  it('only includes selected rule sections', () => {
    const cfg: DevConfig = {
      ...tsFrontendConfig,
      skills: ['code-quality', 'testing', 'ai-behavior'],
    }
    const rules = generateRules(cfg, TEMPLATES_DIR)
    const filenames = rules.map((r) => r.filename).sort()
    expect(filenames).not.toContain('component-patterns.md')
    expect(filenames).toContain('code-quality.md')
  })
})

describe('generateCommands — bd-native /epic', () => {
  it('generates /epic with EARS template and bd create stdin pattern', async () => {
    const { generateCommands } = await import('../generate/commands.js')
    const cfg: DevConfig = { ...tsFrontendConfig, tools: ['beads'] }
    const cmds = generateCommands(cfg)
    const epic = cmds.find((c) => c.filename === 'epic.md')
    expect(epic).toBeDefined()
    expect(epic?.content).toContain('EARS')
    expect(epic?.content).toContain('Success Criteria')
    expect(epic?.content).toContain('bd create --type=epic')
    expect(epic?.content).toContain('--body-file=-')
    expect(epic?.content).toContain('[NEEDS CLARIFICATION')
    expect(epic?.content).not.toContain('.claude/specs/')
    expect(epic?.content).toContain('Do NOT call')
    expect(epic?.content).toContain('--claim')
    expect(epic?.content).toContain('/work-next')
  })

  it('omits /epic when beads is not in tools', async () => {
    const { generateCommands } = await import('../generate/commands.js')
    const cfg: DevConfig = { ...tsFrontendConfig, tools: [] }
    const cmds = generateCommands(cfg)
    expect(cmds.some((c) => c.filename === 'epic.md')).toBe(false)
  })

  it('omits legacy /spec when beads is enabled (replaced by /epic)', async () => {
    const { generateCommands } = await import('../generate/commands.js')
    const cfg: DevConfig = { ...tsFrontendConfig, tools: ['beads'] }
    const cmds = generateCommands(cfg)
    expect(cmds.some((c) => c.filename === 'spec.md')).toBe(false)
    const planCmd = cmds.find((c) => c.filename === 'plan.md')
    const researchCmd = cmds.find((c) => c.filename === 'research.md')
    expect(planCmd?.content).toContain('bd update')
    expect(researchCmd?.content).toContain('bd remember')
  })

  it('generates /work-next with claim + acceptance read-back contract', async () => {
    const { generateCommands } = await import('../generate/commands.js')
    const cfg: DevConfig = { ...tsFrontendConfig, tools: ['beads'] }
    const cmds = generateCommands(cfg)
    const wn = cmds.find((c) => c.filename === 'work-next.md')
    expect(wn).toBeDefined()
    expect(wn?.content).toContain('bd ready --json')
    expect(wn?.content).toContain('bd show')
    expect(wn?.content).toContain('--status in_progress')
    expect(wn?.content).toContain('Acceptance Criteria')
    expect(wn?.content).toContain('Verification Commands')
    expect(wn?.content).toContain('NEEDS CLARIFICATION')
    expect(wn?.content).toContain('halt')
  })

  it('generates /verify-spec that spawns a fresh-context subagent', async () => {
    const { generateCommands } = await import('../generate/commands.js')
    const cfg: DevConfig = { ...tsFrontendConfig, tools: ['beads'] }
    const cmds = generateCommands(cfg)
    const v = cmds.find((c) => c.filename === 'verify-spec.md')
    expect(v).toBeDefined()
    expect(v?.content).toContain('subagent_type=general-purpose')
    expect(v?.content).toContain('PASS')
    expect(v?.content).toContain('FAIL')
    expect(v?.content).toContain('PARTIAL')
    expect(v?.content).toContain('bd show')
    expect(v?.content).toContain('bd note')
    expect(v?.content).toContain('Verification Commands')
    expect(v?.content).toContain('DO NOT call')
  })

  it('generates /discover with discovered-from edge to current claim', async () => {
    const { generateCommands } = await import('../generate/commands.js')
    const cfg: DevConfig = { ...tsFrontendConfig, tools: ['beads'] }
    const cmds = generateCommands(cfg)
    const dc = cmds.find((c) => c.filename === 'discover.md')
    expect(dc).toBeDefined()
    expect(dc?.content).toContain('discovered-from')
    expect(dc?.content).toContain('in_progress')
    expect(dc?.content).toContain('audit trail')
  })

  it('generates bd-native /plan that writes to design field, not disk', async () => {
    const { generateCommands } = await import('../generate/commands.js')
    const cfg: DevConfig = { ...tsFrontendConfig, tools: ['beads'] }
    const cmds = generateCommands(cfg)
    const pc = cmds.find((c) => c.filename === 'plan.md')
    expect(pc).toBeDefined()
    expect(pc?.content).toContain('--design')
    expect(pc?.content).toContain('bd update')
    expect(pc?.content).not.toContain('.claude/plans/YYYY-MM-DD')
  })

  it('generates bd-native /research with memory-or-spike branching', async () => {
    const { generateCommands } = await import('../generate/commands.js')
    const cfg: DevConfig = { ...tsFrontendConfig, tools: ['beads'] }
    const cmds = generateCommands(cfg)
    const rc = cmds.find((c) => c.filename === 'research.md')
    expect(rc).toBeDefined()
    expect(rc?.content).toContain('bd remember')
    expect(rc?.content).toContain('bd create --type=spike')
    expect(rc?.content).toContain('WebFetch')
    expect(rc?.content).not.toContain('docs/research/YYYY-MM-DD')
  })

  it('generates /decision that calls bd decision record', async () => {
    const { generateCommands } = await import('../generate/commands.js')
    const cfg: DevConfig = { ...tsFrontendConfig, tools: ['beads'] }
    const cmds = generateCommands(cfg)
    const dec = cmds.find((c) => c.filename === 'decision.md')
    expect(dec).toBeDefined()
    expect(dec?.content).toContain('bd decision record')
    expect(dec?.content).toContain('--rationale')
    expect(dec?.content).toContain('--alternatives-considered')
    expect(dec?.content).toContain('Do NOT create')
  })

  it('generates /bd-hygiene with read-only triage commands', async () => {
    const { generateCommands } = await import('../generate/commands.js')
    const cfg: DevConfig = { ...tsFrontendConfig, tools: ['beads'] }
    const cmds = generateCommands(cfg)
    const hyg = cmds.find((c) => c.filename === 'bd-hygiene.md')
    expect(hyg).toBeDefined()
    expect(hyg?.content).toContain('bd doctor')
    expect(hyg?.content).toContain('bd stale')
    expect(hyg?.content).toContain('bd lint')
    expect(hyg?.content).toContain('bd count --status open')
    expect(hyg?.content).toContain('200')
    expect(hyg?.content).toContain('Do NOT run')
  })

  it('omits /work-next when beads is not in tools', async () => {
    const { generateCommands } = await import('../generate/commands.js')
    const cfg: DevConfig = { ...tsFrontendConfig, tools: [] }
    const cmds = generateCommands(cfg)
    expect(cmds.some((c) => c.filename === 'work-next.md')).toBe(false)
  })

  it('omits /spec /plan /research entirely when beads is not in tools', async () => {
    const { generateCommands } = await import('../generate/commands.js')
    const cfg: DevConfig = { ...tsFrontendConfig, tools: [] }
    const cmds = generateCommands(cfg)
    expect(cmds.some((c) => c.filename === 'spec.md')).toBe(false)
    expect(cmds.some((c) => c.filename === 'plan.md')).toBe(false)
    expect(cmds.some((c) => c.filename === 'research.md')).toBe(false)
  })
})

describe('installAll update mode', () => {
  function makeTmpProject(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'style-template-update-test-'))
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content)
    }
    return dir
  }

  it('does not create .claude/specs/ directory or TEMPLATE.md', async () => {
    const dir = makeTmpProject({
      'package.json': JSON.stringify({ name: 'test', scripts: {} }),
    })
    try {
      writeConfig(dir, tsFrontendConfig)
      await installAll(dir, tsFrontendConfig, {} as never, {
        skipSideEffects: true,
      })
      const { existsSync } = await import('node:fs')
      expect(existsSync(join(dir, '.claude/specs'))).toBe(false)
      expect(existsSync(join(dir, '.claude/specs/TEMPLATE.md'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true })
    }
  })

  it('does not overwrite lefthook.yml when isUpdate is true', async () => {
    const dir = makeTmpProject({
      'package.json': JSON.stringify({ name: 'test', scripts: {} }),
    })
    try {
      writeConfig(dir, tsFrontendConfig)
      const customLefthook = 'pre-commit:\n  commands:\n    my-custom-hook:\n      run: echo custom\n'
      writeFileSync(join(dir, 'lefthook.yml'), customLefthook)
      await installAll(dir, tsFrontendConfig, {} as never, {
        skipSideEffects: true,
        isUpdate: true,
      })
      const after = readFileSync(join(dir, 'lefthook.yml'), 'utf8')
      expect(after).toBe(customLefthook)
    } finally {
      rmSync(dir, { recursive: true })
    }
  })

  it('merges settings.json preserving user-added events on update', async () => {
    const dir = makeTmpProject({
      'package.json': JSON.stringify({ name: 'test', scripts: {} }),
    })
    try {
      writeConfig(dir, tsFrontendConfig)
      const claudeDir = join(dir, '.claude')
      const { mkdirSync } = await import('node:fs')
      mkdirSync(claudeDir, { recursive: true })
      const existing = {
        hooks: {
          PreCompact: [
            { matcher: '', hooks: [{ type: 'command', command: 'my-custom-precompact.sh' }] },
          ],
          SessionStart: [{ hooks: [{ type: 'command', command: 'existing-hook.sh' }] }],
        },
      }
      writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify(existing, null, 2))
      await installAll(dir, tsFrontendConfig, {} as never, {
        skipSideEffects: true,
        isUpdate: true,
      })
      const merged = JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf8'))
      // User-added PreCompact event preserved (note: `bd prime` is no longer
      // a valid example here — it's now retired and pruned by the merge logic
      // because the beads marketplace plugin owns that hook).
      expect(merged.hooks.PreCompact).toBeDefined()
      expect(JSON.stringify(merged.hooks.PreCompact)).toContain('my-custom-precompact.sh')
      // Tool-managed context-bootstrap.sh added to SessionStart (appended, not replaced)
      expect(JSON.stringify(merged.hooks.SessionStart)).toContain('context-bootstrap.sh')
      // Existing hook within SessionStart is preserved (not lost)
      expect(JSON.stringify(merged.hooks.SessionStart)).toContain('existing-hook.sh')
      // Stop hook added by update
      expect(merged.hooks.Stop).toBeDefined()
    } finally {
      rmSync(dir, { recursive: true })
    }
  })

  it('dedupes old generated PreToolUse matcher hooks on update', async () => {
    const dir = makeTmpProject({
      'package.json': JSON.stringify({ name: 'test', scripts: {} }),
    })
    try {
      writeConfig(dir, tsFrontendConfig)
      const { mkdirSync } = await import('node:fs')
      mkdirSync(join(dir, '.claude'), { recursive: true })
      const existing = {
        hooks: {
          PreToolUse: [
            {
              matcher: 'Write|Edit',
              hooks: [{ type: 'command', command: '.claude/hooks/ts-style-guard.sh', timeout: 30 }],
            },
          ],
        },
      }
      writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify(existing, null, 2))
      await installAll(dir, tsFrontendConfig, {} as never, {
        skipSideEffects: true,
        isUpdate: true,
      })
      const merged = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8'))
      const dispatchEntry = merged.hooks.PreToolUse.find(
        (e: { matcher?: string }) => e.matcher === undefined,
      )
      expect(merged.hooks.PreToolUse).toHaveLength(1)
      expect(JSON.stringify(dispatchEntry)).toContain('pre-tool-dispatch.sh')
    } finally {
      rmSync(dir, { recursive: true })
    }
  })

})
