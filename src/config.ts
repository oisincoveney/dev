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
}
