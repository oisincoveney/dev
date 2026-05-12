import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  existingResetPaths,
  gitWorktreeClean,
  parseResetOptions,
  removeResetPaths,
  RESET_PATHS,
} from '../reset.js'
import { runResetOrchestration, STATE_FILE } from '../orchestrator.js'

describe('reset command helpers', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'oisin-reset-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('parses dangerous reset flags', () => {
    expect(parseResetOptions(['--force', '--yes'])).toEqual({
      force: true,
      yes: true,
      skipExternalTools: false,
    })
    expect(parseResetOptions(['-y', '--skip-external-tools'])).toEqual({
      force: false,
      yes: true,
      skipExternalTools: true,
    })
  })

  it('removes only generated agent paths and preserves .beads', () => {
    for (const relPath of RESET_PATHS) {
      const abs = join(dir, relPath)
      if (relPath.endsWith('.md')) writeFileSync(abs, relPath)
      else mkdirSync(abs, { recursive: true })
    }
    mkdirSync(join(dir, '.beads'), { recursive: true })

    expect(existingResetPaths(dir)).toEqual([...RESET_PATHS])
    removeResetPaths(dir)

    for (const relPath of RESET_PATHS) {
      expect(existsSync(join(dir, relPath))).toBe(false)
    }
    expect(existsSync(join(dir, '.beads'))).toBe(true)
  })

  it('bootstraps reset from legacy .dev.config.json when copier answers are missing', () => {
    writeFileSync(
      join(dir, '.dev.config.json'),
      `${JSON.stringify(
        {
          language: 'typescript',
          variant: 'ts-library',
          framework: null,
          packageManager: 'bun',
          commands: {
            test: 'bun test',
            typecheck: 'tsc --noEmit',
          },
          skills: ['code-quality', 'tracker-workflow'],
          tools: ['beads'],
          workflow: 'bd',
          contractDriven: false,
          targets: ['claude', 'codex'],
        },
        null,
        2,
      )}\n`,
    )

    const result = runResetOrchestration(dir, { skipExternalTools: true })

    expect(result).toEqual({ ok: true })
    expect(readFileSync(join(dir, STATE_FILE), 'utf8')).toContain('"variant": "ts-library"')
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toContain('Use the tracker workflow')
    expect(existsSync(join(dir, '.claude/hooks/pre-tool-dispatch.sh'))).toBe(true)
    expect(existsSync(join(dir, '.codex/hooks/pre-tool-dispatch.sh'))).toBe(true)
  })

  it('requires a clean Git worktree', () => {
    expect(spawnSync('git', ['init'], { cwd: dir }).status).toBe(0)
    writeFileSync(join(dir, 'file.txt'), 'dirty')

    const dirty = gitWorktreeClean(dir)
    expect(dirty.ok).toBe(false)

    expect(spawnSync('git', ['add', 'file.txt'], { cwd: dir }).status).toBe(0)
    expect(
      spawnSync('git', ['commit', '-m', 'chore: initial'], {
        cwd: dir,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Test',
          GIT_AUTHOR_EMAIL: 'test@example.com',
          GIT_COMMITTER_NAME: 'Test',
          GIT_COMMITTER_EMAIL: 'test@example.com',
        },
      }).status,
    ).toBe(0)

    expect(gitWorktreeClean(dir)).toEqual({ ok: true })
  })
})
