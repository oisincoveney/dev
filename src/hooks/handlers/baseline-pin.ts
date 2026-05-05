/**
 * SessionStart hook — pins failing-test baseline at the merge-base of the
 * current branch and main. Writes .claude/baseline-failures.json.
 *
 * Always fail-open. Restores the original branch in a finally block.
 *
 * Migrated from templates/hooks/baseline-pin.sh.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HookHandler } from '../types.js'

const BASELINE_REL_PATH = '.claude/baseline-failures.json'
const FAILING_LINE_PATTERN = /^\s*(FAIL|✗|✘|×)\s+(.+)/

interface DevConfig {
  commands?: { test?: string }
}

interface BaselineData {
  skipped: boolean
  reason?: string
  failing?: string[]
  capturedAt?: number
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T
  } catch {
    return null
  }
}

function git(args: string[], cwd: string): { stdout: string; ok: boolean } {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return {
    stdout: (result.stdout ?? '').trim(),
    ok: result.status === 0 && !result.error,
  }
}

function writeBaseline(cwd: string, data: BaselineData): void {
  const dir = join(cwd, '.claude')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(cwd, BASELINE_REL_PATH), JSON.stringify(data, null, 2))
}

function parseFailingTests(output: string): string[] {
  const failing: string[] = []
  for (const line of output.split('\n')) {
    const match = line.match(FAILING_LINE_PATTERN)
    if (match) failing.push(match[2].trim())
  }
  return failing
}

function findMainBranch(cwd: string): string | null {
  for (const branch of ['main', 'master']) {
    const result = git(['rev-parse', '--verify', branch], cwd)
    if (result.ok) return branch
  }
  return null
}

export const baselinePin: HookHandler = (input) => {
  const cwd = input.cwd ?? process.cwd()

  try {
    const configPath = join(cwd, '.dev.config.json')
    const config = readJson<DevConfig>(configPath)
    const testCommand = config?.commands?.test

    if (!testCommand) {
      writeBaseline(cwd, { skipped: true, reason: 'no test command' })
      return { kind: 'allow' }
    }

    const isGit = git(['rev-parse', '--is-inside-work-tree'], cwd)
    if (!isGit.ok) return { kind: 'allow' }

    const statusResult = git(['status', '--porcelain'], cwd)
    if (!statusResult.ok) return { kind: 'allow' }
    if (statusResult.stdout.length > 0) {
      writeBaseline(cwd, { skipped: true, reason: 'dirty checkout' })
      return { kind: 'allow' }
    }

    const currentRef = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
    if (!currentRef.ok) return { kind: 'allow' }
    const originalRef = currentRef.stdout

    const mainBranch = findMainBranch(cwd)
    if (!mainBranch) return { kind: 'allow' }

    const mergeBaseResult = git(['merge-base', 'HEAD', mainBranch], cwd)
    if (!mergeBaseResult.ok) return { kind: 'allow' }
    const mergeBase = mergeBaseResult.stdout

    const headSha = git(['rev-parse', 'HEAD'], cwd)
    if (headSha.ok && headSha.stdout === mergeBase) {
      writeBaseline(cwd, { skipped: true, reason: 'already at merge base' })
      return { kind: 'allow' }
    }

    try {
      const checkout = spawnSync('git', ['checkout', '--quiet', mergeBase], {
        cwd,
        encoding: 'utf8',
      })
      if (checkout.status !== 0) return { kind: 'allow' }

      const testResult = spawnSync('bash', ['-c', testCommand], {
        cwd,
        encoding: 'utf8',
      })

      const combinedOutput = [testResult.stdout ?? '', testResult.stderr ?? ''].join('\n')
      const failing =
        testResult.status !== 0 ? parseFailingTests(combinedOutput) : []

      writeBaseline(cwd, {
        skipped: false,
        failing,
        capturedAt: Date.now() / 1000,
      })
    } finally {
      spawnSync('git', ['checkout', '--quiet', originalRef], {
        cwd,
        encoding: 'utf8',
      })
    }
  } catch {
    // Fail-open
  }

  return { kind: 'allow' }
}
