/**
 * .dev.config.json — single source of truth for project configuration.
 * Hooks read from this at runtime. Init writes it after interactive prompts.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ProjectVariant } from './skills.js'

export type Language = 'typescript' | 'rust' | 'go' | 'swift' | 'other'
export type WorkflowFramework = 'bd' | 'none'
export type PackageManager = 'bun' | 'pnpm' | 'yarn' | 'npm' | 'cargo' | 'go' | 'swift' | 'other'
export type Target = 'claude' | 'codex' | 'opencode' | 'cursor' | 'lefthook'

export interface DevConfig {
  /** Primary language — equals `languages?.[0] ?? language`. Single-language consumers use this. */
  language: Language
  /** Primary variant — equals `variants?.[0] ?? variant`. Single-variant consumers use this. */
  variant: ProjectVariant
  /**
   * All languages in this project. Generators iterate over this for polyglot setups.
   * Optional for backward compatibility; readConfig hydrates from `language` when missing.
   */
  languages?: ReadonlyArray<Language>
  /**
   * All variants in this project. Generators iterate over this for polyglot setups.
   * Optional for backward compatibility; readConfig hydrates from `variant` when missing.
   */
  variants?: ReadonlyArray<ProjectVariant>
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
  const parsed = JSON.parse(raw) as Omit<Partial<DevConfig>, 'workflow'> & { workflow?: string }
  if (parsed.workflow === 'gsd' || parsed.workflow === 'idd') {
    // biome-ignore lint: CLI deprecation notice
    console.warn(
      `Deprecation: workflow="${parsed.workflow}" is no longer supported. Coercing to "none". Set workflow="bd" in .dev.config.json for the bd-native workflow.`,
    )
    parsed.workflow = 'none'
  }
  // Hydrate `languages`/`variants` from the legacy single fields so polyglot-
  // aware generators always see a non-empty array.
  if (parsed.variants === undefined && parsed.variant !== undefined) {
    parsed.variants = [parsed.variant]
  }
  if (parsed.languages === undefined && parsed.language !== undefined) {
    parsed.languages = [parsed.language]
  }
  if (parsed.variant === undefined && parsed.variants !== undefined && parsed.variants.length > 0) {
    parsed.variant = parsed.variants[0]
  }
  if (
    parsed.language === undefined &&
    parsed.languages !== undefined &&
    parsed.languages.length > 0
  ) {
    parsed.language = parsed.languages[0]
  }
  return parsed as DevConfig
}

export function writeConfig(cwd: string, config: DevConfig): void {
  const path = configPath(cwd)
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}
