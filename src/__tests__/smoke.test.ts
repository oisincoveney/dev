import { describe, expect, it } from 'vitest'
import type { DevConfig } from '../config.js'
import { detectProject } from '../detect.js'
import { generateClaudeSettings } from '../generate/claude-settings.js'
import { generateCodexHooks } from '../generate/codex-hooks.js'
import { generateCursorRules } from '../generate/cursor-rules.js'
import { generateLefthook } from '../generate/lefthook.js'
import { generateLintConfig } from '../generate/lint-config.js'
import { buildClaudeMdBundle, generateClaudeMd } from '../generate/markdown.js'
import { RULE_SKILLS, SUPERPOWER_SKILLS, skillsForVariant } from '../skills.js'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
  workflow: 'idd',
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
  workflow: 'gsd',
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

  it('all rule skills have non-empty markdown sections', () => {
    for (const skill of RULE_SKILLS) {
      expect(skill.markdownSection).toMatch(/^## /)
      expect(skill.markdownSection.length).toBeGreaterThan(50)
    }
  })

  it('testing skill includes proof-of-work requirement', () => {
    const testing = RULE_SKILLS.find((s) => s.id === 'testing')
    expect(testing?.markdownSection).toContain('Proof of work')
    expect(testing?.markdownSection).toContain('the tests should pass')
  })

  it('ai-behavior skill includes no-completion-claims rule', () => {
    const aiBehavior = RULE_SKILLS.find((s) => s.id === 'ai-behavior')
    expect(aiBehavior?.markdownSection).toContain('No completion claims without proof')
    expect(aiBehavior?.markdownSection).toContain('Stop hook checks the session transcript')
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
})

describe('generateCodexHooks', () => {
  it('retargets hook paths from .claude to .codex', () => {
    const codex = generateCodexHooks(tsFrontendConfig) as { hooks: { PreToolUse: unknown[] } }
    const json = JSON.stringify(codex)
    expect(json).toContain('.codex/hooks/')
    expect(json).not.toContain('.claude/hooks/')
  })
})

describe('generateCursorRules', () => {
  it('generates one .mdc per selected skill', () => {
    const rules = generateCursorRules(tsFrontendConfig)
    const selected = RULE_SKILLS.filter((s) => tsFrontendConfig.skills.includes(s.id))
    expect(rules.length).toBe(selected.length)
  })

  it('includes glob metadata', () => {
    const rules = generateCursorRules(tsFrontendConfig)
    expect(rules[0]?.content).toContain('globs:')
    expect(rules[0]?.content).toContain('*.ts')
  })

  it('uses Rust globs for Rust project', () => {
    const rules = generateCursorRules(rustConfig)
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

  it('detects ts-frontend for SvelteKit project', () => {
    const dir = makeTmpProject({
      'package.json': JSON.stringify({
        scripts: { dev: 'vite dev', build: 'vite build', check: 'svelte-check' },
        devDependencies: { '@sveltejs/kit': '^2.0.0', vite: '^5.0.0' },
      }),
    })
    try {
      const result = detectProject(dir)
      expect(result.variant).toBe('ts-frontend')
      expect(result.language).toBe('typescript')
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

describe('generateClaudeMd', () => {
  const fakeAnswers = {} as never

  it('includes commands section with actual project commands', () => {
    const md = generateClaudeMd(tsFrontendConfig, fakeAnswers)
    expect(md).toContain('## Commands')
    expect(md).toContain('vp dev')
    expect(md).toContain('vp check')
  })

  it('includes e2e command in commands block when configured', () => {
    const md = generateClaudeMd(tsFrontendConfig, fakeAnswers)
    expect(md).toContain('e2e:')
    expect(md).toContain('playwright test')
  })

  it('omits e2e line when not configured', () => {
    const noE2e: DevConfig = {
      ...tsFrontendConfig,
      commands: { ...tsFrontendConfig.commands, e2e: undefined },
    }
    const md = generateClaudeMd(noE2e, fakeAnswers)
    expect(md).not.toContain('e2e:')
  })

  it('includes proof-of-work rule in critical rules', () => {
    const bundle = buildClaudeMdBundle(tsFrontendConfig, fakeAnswers)
    expect(bundle.root).toContain('Stop hook checks the session transcript')
  })

  it('includes Karpathy coding principles fragment', () => {
    const bundle = buildClaudeMdBundle(tsFrontendConfig, fakeAnswers)
    expect(bundle.fragments['.claude/docs/coding-principles.md']).toBeDefined()
    const principles = bundle.fragments['.claude/docs/coding-principles.md']
    expect(principles).toContain('Think Before Coding')
    expect(principles).toContain('Simplicity First')
    expect(principles).toContain('Surgical Changes')
    expect(principles).toContain('Goal-Driven Execution')
  })

  it('includes forbidden completion-claim pattern in uncertainty block', () => {
    const bundle = buildClaudeMdBundle(tsFrontendConfig, fakeAnswers)
    const uncertainty = bundle.fragments['.claude/docs/uncertainty.md']
    expect(uncertainty).toContain('this should work')
    expect(uncertainty).toContain('tests should pass')
  })

  it('includes beads block when beads tool is selected', () => {
    const md = generateClaudeMd(tsFrontendConfig, fakeAnswers)
    expect(md).toContain('Beads Issue Tracker')
    expect(md).toContain('bd ready')
  })

  it('includes IDD workflow block when workflow is idd', () => {
    const md = generateClaudeMd(tsFrontendConfig, fakeAnswers)
    expect(md).toContain('Intent-Driven Development')
  })

  it('includes GSD workflow block when workflow is gsd', () => {
    const md = generateClaudeMd(rustConfig, fakeAnswers)
    expect(md).toContain('Get Shit Done')
  })

  it('includes contract-driven block when enabled with language-specific structure', () => {
    const tsMd = generateClaudeMd(tsFrontendConfig, fakeAnswers)
    expect(tsMd).toContain('Contract-Driven Modules')
    expect(tsMd).toContain('contract.ts')
  })

  it('includes hallucination + destructive blocks always', () => {
    const md = generateClaudeMd(rustConfig, fakeAnswers)
    expect(md).toContain('Uncertainty and Verification')
    expect(md).toContain('Destructive Operations')
    expect(md).toContain('No Co-Authored-By')
  })

  it('only includes selected rule sections', () => {
    const configWithoutComponents: DevConfig = {
      ...tsFrontendConfig,
      skills: ['code-quality', 'testing', 'ai-behavior'],
    }
    const md = generateClaudeMd(configWithoutComponents, fakeAnswers)
    expect(md).not.toContain('## Component Patterns')
    expect(md).toContain('## Code Quality')
  })
})
