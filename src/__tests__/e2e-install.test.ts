/**
 * End-to-end install test that runs the real side effects.
 * `bd` is a required dev dependency (see .mise.toml / README "Development").
 * If it isn't installed, this suite fails fast — we do not silently skip.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DevConfig } from '../config.js'
import {
  configureBeadsAfterInit,
  installAll,
  installBeadsCli,
  seedConstitutionDecisions,
  trimBeadsIntegrationBlock,
} from '../install.js'
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
  tools: ['beads'],
  workflow: 'none',
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
  workflow: 'none',
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

  // bd init forks git config, writes hook scripts, and seeds a SQLite db.
  // Observed 5204ms on GitHub Actions ubuntu-latest vs ~700ms locally.
  const BD_INIT_TIMEOUT_MS = 15_000

  it(
    'runs bd init and leaves beads hooks installed',
    () => {
      const result = installBeadsCli(dir)
      expect(result).toEqual({ status: 'created' })
      expect(existsSync(join(dir, '.beads'))).toBe(true)
      // bd init points the repo's core.hooksPath at .beads/hooks/ and writes
      // its hook scripts there. Any subsequent commit fires the real beads
      // hooks — i.e. agent integration is fully wired up.
      expect(existsSync(join(dir, '.beads', 'hooks', 'prepare-commit-msg'))).toBe(true)
    },
    BD_INIT_TIMEOUT_MS,
  )

  it(
    'returns "exists" on second call and does not re-init',
    () => {
      installBeadsCli(dir)
      const second = installBeadsCli(dir)
      expect(second).toEqual({ status: 'exists' })
    },
    BD_INIT_TIMEOUT_MS,
  )

  it(
    'configureBeadsAfterInit sets validation.on-create to warn',
    () => {
      installBeadsCli(dir)
      const result = configureBeadsAfterInit(dir)
      expect(result.ok).toBe(true)
      const cfg = spawnSync('bd', ['config', 'get', 'validation.on-create'], {
        cwd: dir,
        encoding: 'utf8',
      })
      expect(cfg.status).toBe(0)
      expect(cfg.stdout).toContain('warn')
    },
    BD_INIT_TIMEOUT_MS,
  )

  it(
    'configureBeadsAfterInit returns ok=false when .beads/ is missing',
    () => {
      const result = configureBeadsAfterInit(dir)
      expect(result.ok).toBe(false)
    },
    BD_INIT_TIMEOUT_MS,
  )

  it(
    'configureBeadsAfterInit is idempotent (safe to re-run on update)',
    () => {
      installBeadsCli(dir)
      const first = configureBeadsAfterInit(dir)
      const second = configureBeadsAfterInit(dir)
      expect(first.ok).toBe(true)
      expect(second.ok).toBe(true)
    },
    BD_INIT_TIMEOUT_MS,
  )

  it('trimBeadsIntegrationBlock removes Session Completion section', () => {
    const path = join(dir, 'AGENTS.md')
    const original = `# Header

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:abc -->
## Beads Issue Tracker

### Quick Reference
some content

### Rules
- Use bd

## Session Completion

**MANDATORY**: push to remote.

1. PUSH TO REMOTE — git push
<!-- END BEADS INTEGRATION -->
`
    writeFileSync(path, original)
    trimBeadsIntegrationBlock(path)
    const trimmed = readFileSync(path, 'utf8')
    expect(trimmed).toContain('Quick Reference')
    expect(trimmed).toContain('### Rules')
    expect(trimmed).not.toContain('Session Completion')
    expect(trimmed).not.toContain('MANDATORY')
    expect(trimmed).not.toContain('PUSH TO REMOTE')
    expect(trimmed).toContain('<!-- END BEADS INTEGRATION -->')
  })

  it('trimBeadsIntegrationBlock is a no-op when block is missing', () => {
    const path = join(dir, 'AGENTS.md')
    const original = '# Just a header\n\nNo bd block here.\n'
    writeFileSync(path, original)
    trimBeadsIntegrationBlock(path)
    expect(readFileSync(path, 'utf8')).toBe(original)
  })

  it(
    'seedConstitutionDecisions creates pinned decisions and flips validation to error',
    () => {
      installBeadsCli(dir)
      const result = seedConstitutionDecisions(dir, {
        ...config,
        commands: { ...config.commands, test: 'cargo test' },
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.created).toBeGreaterThan(0)

      const list = spawnSync(
        'bd',
        ['list', '--type=decision', '--status', 'all', '--json'],
        { cwd: dir, encoding: 'utf8' },
      )
      expect(list.status).toBe(0)
      const decisions = JSON.parse(list.stdout) as Array<{ title: string; status: string }>
      expect(decisions.length).toBe(result.created)
      expect(decisions.every((d) => d.status === 'pinned')).toBe(true)
      expect(
        decisions.some((d) => d.title.includes('package manager is cargo')),
      ).toBe(true)
      expect(decisions.some((d) => d.title.includes('test command is cargo test'))).toBe(true)

      const cfg = spawnSync('bd', ['config', 'get', 'validation.on-create'], {
        cwd: dir,
        encoding: 'utf8',
      })
      expect(cfg.stdout).toContain('error')
    },
    BD_INIT_TIMEOUT_MS,
  )

  it(
    'seedConstitutionDecisions is idempotent (no duplicates on re-run)',
    () => {
      installBeadsCli(dir)
      const first = seedConstitutionDecisions(dir, config)
      const second = seedConstitutionDecisions(dir, config)
      expect(first.ok).toBe(true)
      expect(second.ok).toBe(true)
      if (!first.ok || !second.ok) return
      expect(first.created).toBeGreaterThan(0)
      expect(second.created).toBe(0)
    },
    BD_INIT_TIMEOUT_MS,
  )

  it('trimBeadsIntegrationBlock is a no-op when Session Completion is already absent', () => {
    const path = join(dir, 'AGENTS.md')
    const original = `<!-- BEGIN BEADS INTEGRATION v:1 -->
## Beads Issue Tracker
just rules, no session completion
<!-- END BEADS INTEGRATION -->
`
    writeFileSync(path, original)
    trimBeadsIntegrationBlock(path)
    expect(readFileSync(path, 'utf8')).toBe(original)
  })

  it('generates all target files with valid content', async () => {
    await installAll(dir, config, answers, { skipSideEffects: true })

    // Every hook script is executable
    const hookDir = join(dir, '.claude', 'hooks')
    const hooks = [
      'destructive-command-guard.sh',
      'block-todowrite.sh',
      'block-coauthor.sh',
      'import-validator.sh',
      'post-edit-check.sh',
      'context-injector.sh',
      'context-bootstrap.sh',
      'pre-compact-prime.sh',
      'pre-stop-verification.sh',
      'ai-antipattern-guard.sh',
      'tdd-guard.sh',
      'pr-size-check.sh',
    ]
    for (const hook of hooks) {
      const path = join(hookDir, hook)
      expect(existsSync(path)).toBe(true)
      // Verify executable
      const { statSync } = await import('node:fs')
      const mode = statSync(path).mode
      expect(mode & 0o111).toBeGreaterThan(0)
    }

    // OpenCode plugin is valid TS-ish content
    const plugin = readFileSync(join(dir, '.opencode/plugins/dev-enforcer.ts'), 'utf8')
    expect(plugin).toContain("import { spawnSync } from 'node:child_process'")
    expect(plugin).toContain('destructive-command-guard.sh')
    expect(plugin).toContain('block-todowrite.sh')

    // Lefthook YAML is valid structure
    const lefthook = readFileSync(join(dir, 'lefthook.yml'), 'utf8')
    expect(lefthook).toContain('commit-msg:')
    expect(lefthook).toContain('pre-commit:')
    expect(lefthook).toContain('pre-push:')
    expect(lefthook).toContain('cargo check')
  })

  it('settings.json hooks reference real script paths', async () => {
    await installAll(dir, config, answers, { skipSideEffects: true })
    const settings = JSON.parse(
      readFileSync(join(dir, '.claude/settings.json'), 'utf8'),
    ) as {
      hooks: Record<
        string,
        Array<{
          matcher?: string
          hooks: Array<{ command: string }>
        }>
      >
    }

    const allCommands: string[] = []
    for (const entries of Object.values(settings.hooks)) {
      for (const entry of entries) {
        for (const hook of entry.hooks) {
          allCommands.push(hook.command)
        }
      }
    }

    // Every referenced .claude/hooks/ script actually exists on disk. Match
    // only on `.sh` filenames so the PATH-prepend `.claude/hooks/bin` segment
    // (which is a directory, not a script) doesn't get checked.
    for (const cmd of allCommands) {
      const match = cmd.match(/\.claude\/hooks\/([^\s'"]+\.sh)/)
      if (match) {
        expect(existsSync(join(dir, '.claude', 'hooks', match[1]))).toBe(true)
      }
    }
  })

  it('codex hooks reference real script paths in .codex', async () => {
    await installAll(dir, config, answers, { skipSideEffects: true })
    const codex = JSON.parse(readFileSync(join(dir, '.codex/hooks.json'), 'utf8')) as {
      hooks: Record<
        string,
        Array<{ hooks: Array<{ command: string }> }>
      >
    }

    for (const entries of Object.values(codex.hooks)) {
      for (const entry of entries) {
        for (const hook of entry.hooks) {
          const match = hook.command.match(/\.codex\/hooks\/([^\s'"]+\.sh)/)
          expect(match).not.toBeNull()
          if (match) {
            expect(existsSync(join(dir, '.codex', 'hooks', match[1]))).toBe(true)
          }
        }
      }
    }
  })
})
