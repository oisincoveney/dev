/**
 * End-to-end install test that runs the real side effects.
 * Tests against actual `bd`, `claude`, and `git` commands.
 * Skipped if those aren't available.
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DevConfig } from '../config.js'
import { installAll } from '../install.js'
import type { Answers } from '../prompts.js'

function hasCmd(name: string): boolean {
  try {
    execSync(`command -v ${name}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const answers: Answers = {
  scaffoldNew: false,
  language: 'rust',
  variant: 'rust-bin',
  framework: null,
  projectName: '',
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

  it.skipIf(!hasCmd('bd'))(
    'runs bd init successfully',
    async () => {
      await installAll(dir, config, answers)
      expect(existsSync(join(dir, '.beads'))).toBe(true)
    },
    60_000,
  )

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

    // Every referenced .claude/hooks/ script actually exists on disk
    for (const cmd of allCommands) {
      const match = cmd.match(/\.claude\/hooks\/([^\s'"]+)/)
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
          const match = hook.command.match(/\.codex\/hooks\/([^\s'"]+)/)
          expect(match).not.toBeNull()
          if (match) {
            expect(existsSync(join(dir, '.codex', 'hooks', match[1]))).toBe(true)
          }
        }
      }
    }
  })
})
