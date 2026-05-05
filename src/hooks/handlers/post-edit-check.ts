/**
 * PostToolUse hook for Write|Edit — runs typecheck + lint after edits to
 * TypeScript, Rust, or Go files. Blocks if errors are found in the
 * edited file.
 *
 * Migrated from templates/hooks/post-edit-check.sh.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HookHandler } from '../types.js'

const CHECKED_EXTENSIONS = new Set(['.ts', '.tsx', '.rs', '.go'])

interface DevConfig {
  commands?: {
    typecheck?: string
    lint?: string
  }
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T
  } catch {
    return null
  }
}

function fileExtension(filePath: string): string {
  const dotIndex = filePath.lastIndexOf('.')
  return dotIndex === -1 ? '' : filePath.slice(dotIndex)
}

function runCheckCommand(command: string, cwd: string): string {
  const result = spawnSync('bash', ['-c', command], { cwd, encoding: 'utf8' })
  const output = [result.stdout ?? '', result.stderr ?? ''].join('\n')
  if (result.status === 0) return ''
  return output
}

function filterLinesToFile(output: string, filePath: string): string[] {
  return output
    .split('\n')
    .filter((line) => line.includes(filePath) && line.trim().length > 0)
}

export const postEditCheck: HookHandler = (input) => {
  const filePath = input.tool_input?.file_path ?? input.tool_input?.filePath
  if (typeof filePath !== 'string' || filePath.length === 0) {
    return { kind: 'allow' }
  }

  const ext = fileExtension(filePath)
  if (!CHECKED_EXTENSIONS.has(ext)) return { kind: 'allow' }

  const cwd = input.cwd ?? process.cwd()
  const configPath = join(cwd, '.dev.config.json')
  if (!existsSync(configPath)) return { kind: 'allow' }

  const config = readJson<DevConfig>(configPath)
  if (!config) return { kind: 'allow' }

  try {
    const errors: string[] = []

    const typecheckCmd = config.commands?.typecheck
    if (typecheckCmd) {
      const typecheckOutput = runCheckCommand(typecheckCmd, cwd)
      if (typecheckOutput.length > 0) {
        const fileErrors = filterLinesToFile(typecheckOutput, filePath)
        if (fileErrors.length > 0) {
          errors.push('Typecheck errors:', ...fileErrors)
        }
      }
    }

    const lintCmd = config.commands?.lint
    if (lintCmd) {
      const lintOutput = runCheckCommand(lintCmd, cwd)
      if (lintOutput.length > 0) {
        const fileErrors = filterLinesToFile(lintOutput, filePath)
        if (fileErrors.length > 0) {
          errors.push('Lint errors:', ...fileErrors)
        }
      }
    }

    if (errors.length === 0) return { kind: 'allow' }

    return {
      kind: 'block',
      reason: ['⛔ Errors in edited file:', ...errors.map((e) => `  ${e}`)].join('\n'),
    }
  } catch {
    return { kind: 'allow' }
  }
}
