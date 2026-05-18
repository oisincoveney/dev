import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DevConfig } from '../config.js'
import { installBacklogCli } from '../install.js'
import { applyInternalTemplate, templateDataFromConfig } from '../orchestrator.js'
import type { Answers } from '../prompts.js'

const answers: Answers = {
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
  skills: ['code-quality', 'architecture', 'testing', 'ai-behavior'],
  tools: ['backlog'],
  workflow: 'backlog',
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

const config: DevConfig = {
  language: answers.language,
  variant: answers.variant,
  framework: null,
  packageManager: answers.packageManager,
  commands: answers.commands,
  skills: answers.skills,
  tools: answers.tools,
  workflow: 'backlog',
  contractDriven: false,
  targets: answers.targets,
}

describe('end-to-end install with real side effects', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dev-e2e-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('initializes Backlog.md and returns exists on second call', () => {
    const result = installBacklogCli(dir)
    expect(result).toEqual({ status: 'created' })
    expect(existsSync(join(dir, 'backlog')) || existsSync(join(dir, '.backlog'))).toBe(true)
    expect(existsSync(join(dir, 'backlog.config.yml'))).toBe(true)

    const second = installBacklogCli(dir)
    expect(second).toEqual({ status: 'exists' })
  }, 20_000)

  it('generates all target files with Backlog.md wiring', async () => {
    applyInternalTemplate(dir, templateDataFromConfig(config))

    const hookDir = join(dir, '.claude', 'hooks')
    const hooks = [
      'destructive-command-guard.sh',
      'git-spice-command-guard.sh',
      'block-todowrite.sh',
      'import-validator.sh',
      'post-edit-check.sh',
      'context-injector.sh',
      'context-bootstrap.sh',
      'pre-compact-prime.sh',
      'pre-stop-verification.sh',
      'ai-antipattern-guard.sh',
      'pr-size-check.sh',
    ]
    for (const hook of hooks) {
      const path = join(hookDir, hook)
      expect(existsSync(path)).toBe(true)
      const { statSync } = await import('node:fs')
      expect(statSync(path).mode & 0o111).toBeGreaterThan(0)
    }

    const mise = readFileSync(join(dir, 'mise.toml'), 'utf8')
    expect(mise).toContain('"npm:backlog.md" = "latest"')
    expect(mise).not.toContain('steveyegge/beads')

    const lefthook = readFileSync(join(dir, 'lefthook.yml'), 'utf8')
    expect(lefthook).toContain('commit-msg:')
    expect(lefthook).toContain('pre-commit:')
    expect(lefthook).toContain('pre-push:')
    expect(lefthook).not.toContain('bd-dolt-push')
    expect(lefthook).not.toContain('bd-ticket-ref')

    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(agents).toContain('Backlog.md is the source of truth')
    expect(agents).toContain('backlog task list -s "To Do" --plain')
    expect(agents).toContain('All implementation, including `/quick`, runs in Worktrunk-managed agent worktrees')
    expect(agents).not.toContain('bd prime')
    expect(agents).not.toContain('beads')

    const plugin = readFileSync(join(dir, '.opencode/plugins/dev-enforcer.ts'), 'utf8')
    expect(plugin).toContain('destructive-command-guard.sh')
    expect(plugin).toContain('git-spice-command-guard.sh')
    expect(plugin).toContain('block-todowrite.sh')
    expect(plugin).toContain('BACKLOG_ENABLED')
    expect(plugin).not.toContain('BEADS_ENABLED')

    expect(readFileSync(join(dir, '.agents/skills/tracker-workflow/SKILL.md'), 'utf8')).toContain('Backlog.md')
    expect(readFileSync(join(dir, '.agents/skills/work-next/SKILL.md'), 'utf8')).toContain('backlog task list')
    expect(readFileSync(join(dir, 'mise.toml'), 'utf8')).toContain('Nested Worktrunk worktree detected')
    expect(readFileSync(join(dir, '.config/wt.toml'), 'utf8')).toContain('repo_root="$(git rev-parse --show-toplevel)"')
    expect(readFileSync(join(dir, '.claude/commands/land-prs.md'), 'utf8')).toContain('bunx @oisincoveney/dev land-prs')
    expect(readFileSync(join(dir, '.claude/commands/pr-daemon.md'), 'utf8')).toContain('bunx @oisincoveney/dev pr-daemon')
    expect(readFileSync(join(dir, '.codex/commands/land-prs.md'), 'utf8')).toContain('bunx @oisincoveney/dev land-prs')
    expect(readFileSync(join(dir, '.opencode/commands/pr-daemon.md'), 'utf8')).toContain('bunx @oisincoveney/dev pr-daemon')
    expect(existsSync(join(dir, '.codex/skills/quick'))).toBe(true)
    expect(existsSync(join(dir, '.opencode/skills/quick'))).toBe(true)
    expect(existsSync(join(dir, '.cursor/skills/quick'))).toBe(true)
  })

  it('settings.json hooks reference real script paths', () => {
    applyInternalTemplate(dir, templateDataFromConfig(config))
    const settings = JSON.parse(readFileSync(join(dir, '.claude/settings.json'), 'utf8')) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>
    }

    for (const entries of Object.values(settings.hooks)) {
      for (const entry of entries) {
        for (const hook of entry.hooks) {
          const match = hook.command.match(/\.claude\/hooks\/([^\s'"]+\.sh)/)
          if (match) expect(existsSync(join(dir, '.claude', 'hooks', match[1]))).toBe(true)
        }
      }
    }
  })

  it('codex hooks reference real script paths in .codex', () => {
    applyInternalTemplate(dir, templateDataFromConfig(config))
    const codex = JSON.parse(readFileSync(join(dir, '.codex/hooks.json'), 'utf8')) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>
    }

    for (const entries of Object.values(codex.hooks)) {
      for (const entry of entries) {
        for (const hook of entry.hooks) {
          const match = hook.command.match(/\.codex\/hooks\/([^\s'"]+\.sh)/)
          expect(match).not.toBeNull()
          if (match) expect(existsSync(join(dir, '.codex', 'hooks', match[1]))).toBe(true)
        }
      }
    }
  })
})
