/**
 * .dev.config.json — single source of truth for project configuration.
 * Hooks read from this at runtime. Init writes it after interactive prompts.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ProjectVariant } from './skills.js'

export type Language = 'typescript' | 'rust' | 'go' | 'swift' | 'other'
export type WorkflowFramework = 'gsd' | 'idd' | 'none'
export type PackageManager = 'bun' | 'pnpm' | 'yarn' | 'npm' | 'cargo' | 'go' | 'swift' | 'other'
export type Target = 'claude' | 'codex' | 'opencode' | 'cursor' | 'lefthook'
export type IssueTemplateFormat = 'ears' | 'gherkin' | 'checklist'

export interface EnforcementConfig {
  baselinePin?: boolean
  docsFirst?: boolean
  symbolCheck?: boolean
  auditLog?: boolean
  multiEvent?: boolean
}

export interface BeadsWorkflowConfig {
  epicTicketLoop?: boolean
  issueTemplates?: IssueTemplateFormat
  requireClaim?: boolean
}

export interface McpConfig {
  context7?: boolean
}

export interface DevConfig {
  language: Language
  variant: ProjectVariant
  framework: string | null
  packageManager: PackageManager
  commands: {
    dev: string | null
    build: string | null
    test: string | null
    typecheck: string | null
    lint: string | null
    format: string | null
    e2e?: string | null
  }
  skills: ReadonlyArray<string>
  tools: ReadonlyArray<string>
  workflow: WorkflowFramework
  contractDriven: boolean
  targets: ReadonlyArray<Target>
  models?: {
    default: string
    planning: string
    simple_edits: string
    review: string
  }
  bannedWords?: ReadonlyArray<string>
  enforcement?: EnforcementConfig
  beadsWorkflow?: BeadsWorkflowConfig
  mcp?: McpConfig
}

const CONFIG_FILENAME = '.dev.config.json'

export function configPath(cwd: string): string {
  return join(cwd, CONFIG_FILENAME)
}

export function readConfig(cwd: string): DevConfig | null {
  const path = configPath(cwd)
  if (!existsSync(path)) {
    return null
  }
  const raw = readFileSync(path, 'utf8')
  return JSON.parse(raw) as DevConfig
}

export function writeConfig(cwd: string, config: DevConfig): void {
  const path = configPath(cwd)
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}
