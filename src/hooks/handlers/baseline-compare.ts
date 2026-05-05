/**
 * Stop hook — compares current test failures against the pinned baseline.
 *
 * Blocks if any tests that were passing at baseline are now failing
 * (regressions). Fail-open.
 *
 * Migrated from templates/hooks/baseline-compare.sh.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HookHandler } from '../types.js'

const BASELINE_REL_PATH = '.claude/baseline-failures.json'
const FAILING_LINE_PATTERN = /^\s*(FAIL|✗|✘|×)\s+(.+)/

interface DevConfig {
  commands?: { test?: string }
}

interface BaselineData {
  skipped: boolean
  failing?: string[]
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T
  } catch {
    return null
  }
}

function parseFailingTests(output: string): string[] {
  const failing: string[] = []
  for (const line of output.split('\n')) {
    const match = line.match(FAILING_LINE_PATTERN)
    if (match) failing.push(match[2].trim())
  }
  return failing
}

export const baselineCompare: HookHandler = (input) => {
  const cwd = input.cwd ?? process.cwd()

  try {
    const baselinePath = join(cwd, BASELINE_REL_PATH)
    if (!existsSync(baselinePath)) return { kind: 'allow' }

    const baseline = readJson<BaselineData>(baselinePath)
    if (!baseline || baseline.skipped) return { kind: 'allow' }

    const configPath = join(cwd, '.dev.config.json')
    const config = readJson<DevConfig>(configPath)
    const testCommand = config?.commands?.test
    if (!testCommand) return { kind: 'allow' }

    const testResult = spawnSync('bash', ['-c', testCommand], {
      cwd,
      encoding: 'utf8',
    })

    if (testResult.status === 0) return { kind: 'allow' }

    const combinedOutput = [testResult.stdout ?? '', testResult.stderr ?? ''].join('\n')
    const currentFailing = parseFailingTests(combinedOutput)

    const baselineFailing = new Set(baseline.failing ?? [])
    const regressions = currentFailing.filter((name) => !baselineFailing.has(name))

    if (regressions.length === 0) return { kind: 'allow' }

    const regressionList = regressions.map((name) => `  - ${name}`).join('\n')
    return {
      kind: 'block',
      reason: [
        `⛔ ${regressions.length} regression(s) detected — tests passing at baseline are now failing:`,
        regressionList,
        '',
        '   Fix before completing the task.',
      ].join('\n'),
    }
  } catch {
    return { kind: 'allow' }
  }
}
