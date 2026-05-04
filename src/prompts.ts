/**
 * Interactive prompts for init, using @clack/prompts.
 *
 * Returns a complete Answers object that init.ts uses to write the config
 * and drive file generation.
 */

import * as p from '@clack/prompts'
import type {
  Language,
  PackageManager,
  Target,
  WorkflowFramework,
} from './config.js'
import type { Detected } from './detect.js'
import {
  type ProjectVariant,
  type Skill,
  ruleSkillsForVariant,
  superpowerSkillsForVariant,
} from './skills.js'

export interface Answers {
  language: Language
  variant: ProjectVariant
  languages?: ReadonlyArray<Language>
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
  mcpServers: ReadonlyArray<string>
  models: {
    default: string
    planning: string
    simple_edits: string
    review: string
  }
}

function cancelGuard<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel('Aborted.')
    process.exit(0)
  }
  return value
}

export async function runPrompts(detected: Detected): Promise<Answers> {
  const variants = await promptVariants(detected.variant ?? undefined)
  const variant = variants[0]
  const language = languageForVariant(variant)
  const languages = uniqueLanguages(variants)
  const framework = await promptFrameworkForPrimary(variant)

  const packageManager = resolvePackageManager(detected, language)

  const defaults = defaultCommandsFor(variant, packageManager, detected)

  const commands: Answers['commands'] = {
    dev: await askOptionalCommand('Dev command (how to run the app)?', defaults.dev),
    build: await askOptionalCommand('Build command?', defaults.build),
    test: await askOptionalCommand('Test command?', defaults.test),
    typecheck: await askOptionalCommand('Typecheck command?', defaults.typecheck),
    lint: await askOptionalCommand('Lint command?', defaults.lint),
    format: await askOptionalCommand('Format command?', defaults.format),
  }

  if (variant === 'ts-frontend' || variant === 'ts-fullstack') {
    commands.e2e = await askCommand('Browser test command (Playwright)?', 'playwright test')
  }

  const allCommandsUnset =
    commands.dev === null &&
    commands.build === null &&
    commands.test === null &&
    commands.typecheck === null &&
    commands.lint === null &&
    commands.format === null
  if (allCommandsUnset) {
    p.log.info('No commands configured yet. Run `oisin-dev set-commands` once you know them.')
  }

  const ruleSkills = ruleSkillsForVariant(variant)
  const skillSelection = cancelGuard(
    await p.multiselect<string>({
      message: 'Rule categories (all selected by default, toggle to remove)',
      options: ruleSkills.map((skill) => ({
        value: skill.id,
        label: skill.name,
        hint: skill.description,
      })),
      initialValues: ruleSkills.map((skill) => skill.id),
      required: false,
    }),
  )

  const superpowers = superpowerSkillsForVariant(variant)
  const superpowerSelection = cancelGuard(
    await p.multiselect<string>({
      message: 'Claude Code skills to copy project-local (from ~/.agents/skills/)',
      options: superpowers.map((skill) => ({
        value: skill.id,
        label: skill.name,
        hint: skill.description,
      })),
      initialValues: superpowers.map((skill) => skill.id),
      required: false,
    }),
  )

  const workflow = cancelGuard(
    await p.select<WorkflowFramework>({
      message: 'Workflow framework?',
      options: [
        { value: 'bd', label: 'bd-native — beads is the source of truth (recommended when beads is selected)' },
        { value: 'none', label: 'None — lightweight, no opinionated workflow' },
      ],
    }),
  )

  const tools = cancelGuard(
    await p.multiselect<string>({
      message: 'Tools',
      options: [
        {
          value: 'beads',
          label: 'Beads (bd) — issue tracking (blocks TodoWrite)',
        },
        {
          value: 'contract-driven',
          label: 'Contract-driven modules (module/index.ts + contract.ts pattern)',
        },
      ],
      initialValues: ['beads', 'contract-driven'],
      required: false,
    }),
  )

  const targets = cancelGuard(
    await p.multiselect<Target>({
      message: 'AI tools to install for',
      options: [
        { value: 'claude', label: 'Claude Code (.claude/)' },
        { value: 'codex', label: 'Codex CLI (.codex/)' },
        { value: 'opencode', label: 'OpenCode (.opencode/)' },
        { value: 'cursor', label: 'Cursor (.cursor/rules/)' },
        { value: 'lefthook', label: 'Git hooks (lefthook.yml)' },
      ],
      initialValues: ['claude', 'codex', 'opencode', 'cursor', 'lefthook'],
      required: true,
    }),
  )

  const mcpServers: ReadonlyArray<string> = []
  if (targets.includes('claude')) {
    const defaultMcp = ['memory', 'serena']
    if (detected.hasGitRemote) defaultMcp.push('github')
    const selection = cancelGuard(
      await p.multiselect<string>({
        message: 'MCP servers to register for Claude Code',
        options: [
          {
            value: 'memory',
            label: 'Memory MCP (@anthropic-ai/mcp-server-memory)',
            hint: 'Cross-session knowledge graph',
          },
          {
            value: 'serena',
            label: 'Serena',
            hint: 'Semantic code search and navigation via LSP',
          },
          {
            value: 'github',
            label: 'GitHub MCP',
            hint: detected.hasGitRemote ? 'Detected GitHub remote' : 'No GitHub remote detected',
          },
        ],
        initialValues: defaultMcp,
        required: false,
      }),
    )
    ;(mcpServers as string[]).push(...selection)
  }

  const modelProfile = cancelGuard(
    await p.select<'balanced' | 'max-quality' | 'cost-optimized' | 'custom'>({
      message: 'Model routing profile?',
      options: [
        {
          value: 'balanced',
          label: 'Balanced — Sonnet default, Opus for planning/review, Haiku for simple edits',
        },
        {
          value: 'max-quality',
          label: 'Max quality — Opus for everything',
        },
        {
          value: 'cost-optimized',
          label: 'Cost-optimized — Haiku default, Sonnet for planning, Opus only for review',
        },
        { value: 'custom', label: 'Custom — enter each model manually' },
      ],
    }),
  )

  const models = await resolveModelProfile(modelProfile)

  return {
    language,
    variant,
    languages,
    variants,
    framework,
    packageManager,
    commands,
    skills: [...skillSelection, ...superpowerSelection],
    tools,
    workflow,
    contractDriven: tools.includes('contract-driven'),
    targets,
    mcpServers,
    models,
  }
}

export const ALL_VARIANT_OPTIONS: ReadonlyArray<{ value: ProjectVariant; label: string }> = [
  { value: 'ts-frontend', label: 'TypeScript Frontend (Vite+)' },
  { value: 'ts-backend', label: 'TypeScript Backend' },
  { value: 'ts-fullstack', label: 'TypeScript Full-Stack' },
  { value: 'ts-library', label: 'TypeScript Library' },
  { value: 'ts-monorepo', label: 'TypeScript Monorepo (Vite+ workspaces)' },
  { value: 'rust-bin', label: 'Rust (binary)' },
  { value: 'rust-lib', label: 'Rust (library)' },
  { value: 'rust-workspace', label: 'Rust Workspace (monorepo)' },
  { value: 'go-bin', label: 'Go (binary)' },
  { value: 'go-lib', label: 'Go (library)' },
  { value: 'go-workspace', label: 'Go Workspace (multi-module)' },
  { value: 'swift-app', label: 'Swift App (Xcode / SwiftUI)' },
  { value: 'swift-lib', label: 'Swift Library (Swift Package Manager)' },
  { value: 'swift-package', label: 'Swift Package / CLI (Swift Package Manager)' },
  { value: 'other-app', label: 'Other language — language-agnostic rules only' },
]

export async function promptVariants(
  detected?: ProjectVariant,
): Promise<ReadonlyArray<ProjectVariant>> {
  // Multiselect — for polyglot projects (Go + TS, etc.) the user picks every
  // variant in the project. The first toggled becomes the "primary" used for
  // single-variant defaults (commands, package manager, framework prompt).
  const selection = cancelGuard(
    await p.multiselect<ProjectVariant>({
      message: 'What are you building? (Space to toggle. The first one selected is the primary.)',
      options: ALL_VARIANT_OPTIONS.map((opt) => ({ ...opt })),
      initialValues: detected ? [detected] : undefined,
      required: true,
    }),
  )
  return selection
}

async function promptFrameworkForPrimary(variant: ProjectVariant): Promise<string | null> {
  if (variant === 'ts-frontend' || variant === 'ts-fullstack') {
    return cancelGuard(
      await p.select<string>({
        message: 'Frontend framework?',
        options: [
          { value: 'react', label: 'React' },
          { value: 'vue', label: 'Vue' },
          { value: 'svelte', label: 'Svelte' },
          { value: 'tanstack-start', label: '@tanstack/start' },
        ],
      }),
    )
  }
  if (variant === 'ts-backend') {
    return cancelGuard(
      await p.select<string>({
        message: 'Backend framework?',
        options: [
          { value: 'hono', label: 'Hono' },
          { value: 'fastify', label: 'Fastify' },
          { value: 'express', label: 'Express' },
          { value: 'none', label: 'None (library/CLI)' },
        ],
      }),
    )
  }
  if (variant === 'swift-app') {
    return cancelGuard(
      await p.select<string>({
        message: 'UI framework?',
        options: [
          { value: 'swiftui', label: 'SwiftUI' },
          { value: 'uikit', label: 'UIKit' },
          { value: 'appkit', label: 'AppKit (macOS)' },
        ],
      }),
    )
  }
  return null
}

function uniqueLanguages(variants: ReadonlyArray<ProjectVariant>): ReadonlyArray<Language> {
  const seen = new Set<Language>()
  const out: Language[] = []
  for (const v of variants) {
    const lang = languageForVariant(v)
    if (!seen.has(lang)) {
      seen.add(lang)
      out.push(lang)
    }
  }
  return out
}

const DEFAULT_MODELS = {
  opus: 'claude-opus-4-6',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5-20251001',
} as const

async function resolveModelProfile(
  profile: 'balanced' | 'max-quality' | 'cost-optimized' | 'custom',
): Promise<Answers['models']> {
  switch (profile) {
    case 'balanced':
      return {
        default: DEFAULT_MODELS.sonnet,
        planning: DEFAULT_MODELS.opus,
        simple_edits: DEFAULT_MODELS.haiku,
        review: DEFAULT_MODELS.opus,
      }
    case 'max-quality':
      return {
        default: DEFAULT_MODELS.opus,
        planning: DEFAULT_MODELS.opus,
        simple_edits: DEFAULT_MODELS.opus,
        review: DEFAULT_MODELS.opus,
      }
    case 'cost-optimized':
      return {
        default: DEFAULT_MODELS.haiku,
        planning: DEFAULT_MODELS.sonnet,
        simple_edits: DEFAULT_MODELS.haiku,
        review: DEFAULT_MODELS.opus,
      }
    case 'custom': {
      const def = cancelGuard(
        await p.text({
          message: 'Default model',
          initialValue: DEFAULT_MODELS.sonnet,
        }),
      )
      const planning = cancelGuard(
        await p.text({
          message: 'Planning model',
          initialValue: DEFAULT_MODELS.opus,
        }),
      )
      const simple = cancelGuard(
        await p.text({
          message: 'Simple edits model',
          initialValue: DEFAULT_MODELS.haiku,
        }),
      )
      const review = cancelGuard(
        await p.text({
          message: 'Review model',
          initialValue: DEFAULT_MODELS.opus,
        }),
      )
      return { default: def, planning, simple_edits: simple, review }
    }
  }
}

export async function askCommand(message: string, defaultValue: string): Promise<string> {
  const value = cancelGuard(
    await p.text({
      message,
      initialValue: defaultValue,
      placeholder: defaultValue,
    }),
  )
  return value.length === 0 ? defaultValue : value
}

export async function askOptionalCommand(
  message: string,
  defaultValue: string | null,
): Promise<string | null> {
  if (defaultValue === null || defaultValue.length === 0) return null
  return askCommand(message, defaultValue)
}

function languageForVariant(variant: ProjectVariant): Language {
  if (variant.startsWith('ts-')) return 'typescript'
  if (variant.startsWith('rust-')) return 'rust'
  if (variant.startsWith('swift-')) return 'swift'
  if (variant.startsWith('other-')) return 'other'
  return 'go'
}

function resolvePackageManager(detected: Detected, language: Language): PackageManager {
  if (detected.packageManager) return detected.packageManager
  switch (language) {
    case 'typescript':
      return 'bun'
    case 'rust':
      return 'cargo'
    case 'go':
      return 'go'
    case 'swift':
      return 'swift'
    case 'other':
      return 'other'
  }
}

export function defaultCommandsFor(
  variant: ProjectVariant,
  pm: PackageManager,
  detected: Detected,
): Answers['commands'] {
  // Prefer what was detected
  const d = detected.commands

  if (variant.startsWith('ts-')) {
    return {
      dev: d.dev ?? 'vp dev',
      build: d.build ?? 'vp build',
      test: d.test ?? 'vp test',
      typecheck: d.typecheck ?? 'vp check',
      lint: d.lint ?? 'vp check',
      format: d.format ?? 'vp check',
    }
  }

  if (variant.startsWith('rust-')) {
    return {
      dev: d.dev ?? 'cargo run',
      build: d.build ?? 'cargo build --release',
      test: d.test ?? 'cargo test',
      typecheck: d.typecheck ?? 'cargo check',
      lint: d.lint ?? 'cargo clippy --all-targets -- -D warnings',
      format: d.format ?? 'cargo fmt',
    }
  }

  if (variant.startsWith('swift-')) {
    if (variant === 'swift-app') {
      const scheme = detected.xcodeScheme ?? '<Scheme>'
      const dest = "platform=iOS Simulator,name=iPhone 16"
      return {
        dev: d.dev ?? '',
        build: d.build ?? `xcodebuild build -scheme ${scheme} -destination '${dest}'`,
        test: d.test ?? `xcodebuild test -scheme ${scheme} -destination '${dest}'`,
        typecheck: d.typecheck ?? `xcodebuild build -scheme ${scheme} -destination '${dest}'`,
        lint: d.lint ?? 'swiftlint lint',
        format: d.format ?? 'swiftformat .',
      }
    }
    return {
      dev: d.dev ?? 'swift run',
      build: d.build ?? 'swift build',
      test: d.test ?? 'swift test',
      typecheck: d.typecheck ?? 'swift build',
      lint: d.lint ?? 'swiftlint lint',
      format: d.format ?? 'swiftformat .',
    }
  }

  if (variant.startsWith('other-')) {
    return {
      dev: d.dev,
      build: d.build,
      test: d.test,
      typecheck: d.typecheck,
      lint: d.lint,
      format: d.format,
    }
  }

  // Go
  return {
    dev: d.dev ?? 'go run .',
    build: d.build ?? 'go build ./...',
    test: d.test ?? 'go test ./...',
    typecheck: d.typecheck ?? 'go vet ./...',
    lint: d.lint ?? 'golangci-lint run',
    format: d.format ?? 'gofmt -w .',
  }
}
