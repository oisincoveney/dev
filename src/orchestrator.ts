import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, stringify } from 'yaml'
import type { DevConfig, Language, PackageManager, Target, WorkflowFramework } from './config.js'
import type { Answers } from './prompts.js'
import type { ProjectVariant } from './skills.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export const COPIER_TEMPLATE_DIR = resolve(__dirname, '..', 'templates', 'copier')
export const STATE_FILE = '.copier-answers.yml'
export const LEGACY_CONFIG_FILE = '.dev.config.json'
export const COPIER_TOOL_SPEC = 'pipx:copier@9.14.0'
const RETIRED_GENERATED_PATHS = [
  '.claude/hooks/tdd-guard.sh',
  '.codex/hooks/tdd-guard.sh',
] as const

export type OrchestratorResult =
  | { ok: true }
  | { ok: false; message: string }

export interface OrchestratorOptions {
  skipExternalTools?: boolean
}

export interface TemplateData {
  language: string
  variant: string
  languages: string[]
  variants: string[]
  framework: string
  package_manager: string
  commands: Record<string, string>
  skills: string[]
  tools: string[]
  workflow: string
  contract_driven: boolean
  targets: string[]
  mcp_servers: string[]
  models: Record<string, string>
  beads_enabled: boolean
  has_typescript: boolean
  has_frontend: boolean
}

export function templateDataFromAnswers(answers: Answers): TemplateData {
  const languages = answers.languages ?? [answers.language]
  const variants = answers.variants ?? [answers.variant]
  return {
    language: answers.language,
    variant: answers.variant,
    languages: [...languages],
    variants: [...variants],
    framework: answers.framework ?? '',
    package_manager: answers.packageManager,
    commands: compactCommands(answers.commands),
    skills: [...answers.skills],
    tools: [...answers.tools],
    workflow: answers.workflow,
    contract_driven: answers.contractDriven,
    targets: [...answers.targets],
    mcp_servers: [...answers.mcpServers],
    models: answers.models ?? {},
    beads_enabled: answers.tools.includes('beads'),
    has_typescript: languages.includes('typescript'),
    has_frontend: variants.some((variant) => variant === 'ts-frontend' || variant === 'ts-fullstack'),
  }
}

export function templateDataFromConfig(config: DevConfig): TemplateData {
  const languages = config.languages ?? [config.language]
  const variants = config.variants ?? [config.variant]
  return {
    language: config.language,
    variant: config.variant,
    languages: [...languages],
    variants: [...variants],
    framework: config.framework ?? '',
    package_manager: config.packageManager,
    commands: compactCommands(config.commands),
    skills: [...config.skills],
    tools: [...config.tools],
    workflow: config.workflow,
    contract_driven: config.contractDriven,
    targets: [...config.targets],
    mcp_servers: [],
    models: config.models ?? {},
    beads_enabled: config.tools.includes('beads'),
    has_typescript: languages.includes('typescript'),
    has_frontend: variants.some((variant) => variant === 'ts-frontend' || variant === 'ts-fullstack'),
  }
}

function compactCommands(commands: Answers['commands']): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of ['dev', 'build', 'test', 'typecheck', 'lint', 'format', 'e2e'] as const) {
    const value = commands[key]
    if (typeof value === 'string' && value.length > 0) out[key] = value
  }
  return out
}

export function readInternalState(cwd: string): TemplateData | null {
  const path = join(cwd, STATE_FILE)
  if (!existsSync(path)) return null
  const raw = readFileSync(path, 'utf8')
  if (raw.trimStart().startsWith('{')) return JSON.parse(raw) as TemplateData
  return null
}

export function writeInternalState(cwd: string, data: TemplateData): void {
  writeFileSync(join(cwd, STATE_FILE), `${JSON.stringify({ _src_path: COPIER_TEMPLATE_DIR, ...data })}\n`)
}

export function runInitOrchestration(
  cwd: string,
  answers: Answers,
  options: OrchestratorOptions = {},
): OrchestratorResult {
  const data = templateDataFromAnswers(answers)
  if (options.skipExternalTools) {
    applyInternalTemplate(cwd, data)
    writeInternalState(cwd, data)
    return { ok: true }
  }

  const dataFile = join(cwd, '.copier-data.tmp.json')
  writeFileSync(dataFile, `${JSON.stringify(data, null, 2)}\n`)
  try {
    const copy = runMise(cwd, [
      ...copierMiseArgs(
        'copy',
        '--trust',
        '--defaults',
        '--overwrite',
        '--data-file',
        dataFile,
        COPIER_TEMPLATE_DIR,
        cwd,
      ),
    ])
    if (!copy.ok) return copy
  } finally {
    rmSync(dataFile, { force: true })
  }

  return runPostTemplateTools(cwd, data)
}

export function copierMiseArgs(...copierArgs: string[]): string[] {
  return ['exec', COPIER_TOOL_SPEC, '--', 'copier', ...copierArgs]
}

export function runUpdateOrchestration(
  cwd: string,
  options: OrchestratorOptions = {},
): OrchestratorResult {
  const data = readInternalState(cwd)
  if (options.skipExternalTools) {
    if (data === null) {
      return { ok: false, message: `No ${STATE_FILE} found. Run \`oisin-dev init\` first.` }
    }
    applyInternalTemplate(cwd, data)
    pruneRetiredGeneratedPaths(cwd)
    return { ok: true }
  }
  if (!existsSync(join(cwd, STATE_FILE))) {
    return { ok: false, message: `No ${STATE_FILE} found. Run \`oisin-dev init\` first.` }
  }
  refreshCopierSourcePath(cwd)
  ensureMiseToml(cwd, data ?? undefined)
  const trust = runMise(cwd, ['trust', '-y'])
  if (!trust.ok) return trust
  const install = runMise(cwd, ['install'])
  if (!install.ok) return install
  const update = runMise(cwd, copierMiseArgs('recopy', '--trust', '--force'))
  if (!update.ok) return update
  return runPostTemplateTools(cwd, data ?? undefined)
}

export function runResetOrchestration(
  cwd: string,
  options: OrchestratorOptions = {},
): OrchestratorResult {
  const bootstrap = bootstrapInternalStateFromLegacyConfig(cwd)
  if (!bootstrap.ok) return bootstrap
  if (options.skipExternalTools) return runUpdateOrchestration(cwd, options)
  if (!existsSync(join(cwd, STATE_FILE))) {
    return {
      ok: false,
      message: `No ${STATE_FILE} or ${LEGACY_CONFIG_FILE} found. Run \`oisin-dev init\` first.`,
    }
  }
  refreshCopierSourcePath(cwd)
  const data = readInternalState(cwd)
  ensureMiseToml(cwd, data ?? undefined)
  const trust = runMise(cwd, ['trust', '-y'])
  if (!trust.ok) return trust
  const install = runMise(cwd, ['install'])
  if (!install.ok) return install
  const recopy = runMise(cwd, copierMiseArgs('recopy', '--trust', '--force'))
  if (!recopy.ok) return recopy
  return runPostTemplateTools(cwd, data ?? undefined)
}

export function bootstrapInternalStateFromLegacyConfig(cwd: string): OrchestratorResult {
  if (existsSync(join(cwd, STATE_FILE))) return { ok: true }

  const legacyPath = join(cwd, LEGACY_CONFIG_FILE)
  if (!existsSync(legacyPath)) return { ok: true }

  try {
    const raw = JSON.parse(readFileSync(legacyPath, 'utf8')) as unknown
    writeInternalState(cwd, legacyConfigToTemplateData(raw))
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      message: `Could not migrate ${LEGACY_CONFIG_FILE} to ${STATE_FILE}: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

function legacyConfigToTemplateData(value: unknown): TemplateData {
  const config = objectRecord(value)
  const language = stringValue(config.language, 'other') as Language
  const variant = stringValue(config.variant, 'other-app') as ProjectVariant
  const commands = objectRecord(config.commands ?? {})
  const legacy: DevConfig = {
    language,
    variant,
    languages: stringArray(config.languages, [language]) as Language[],
    variants: stringArray(config.variants, [variant]) as ProjectVariant[],
    framework: nullableString(config.framework),
    packageManager: stringValue(config.packageManager, 'other') as PackageManager,
    commands: {
      dev: nullableString(commands.dev),
      build: nullableString(commands.build),
      test: nullableString(commands.test),
      typecheck: nullableString(commands.typecheck),
      lint: nullableString(commands.lint),
      format: nullableString(commands.format),
      e2e: nullableString(commands.e2e),
    },
    skills: stringArray(config.skills, []),
    tools: stringArray(config.tools, []),
    workflow: stringValue(config.workflow, 'none') as WorkflowFramework,
    contractDriven: config.contractDriven === true,
    targets: stringArray(config.targets, ['claude', 'codex', 'lefthook']) as Target[],
    models: objectRecord(config.models ?? {}) as DevConfig['models'],
  }
  return templateDataFromConfig(legacy)
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function stringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback
  const strings = value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
  return strings.length > 0 ? strings : fallback
}

function runPostTemplateTools(cwd: string, data?: TemplateData): OrchestratorResult {
  const templateData = data ?? readInternalState(cwd) ?? undefined
  pruneRetiredGeneratedPaths(cwd)
  ensureMiseToml(cwd, templateData)
  ensureLefthookYml(cwd, templateData)
  const trust = runMise(cwd, ['trust', '-y'])
  if (!trust.ok) return trust
  const install = runMise(cwd, ['install'])
  if (!install.ok) return install

  const dotagents = runMise(cwd, ['exec', '--', 'dotagents', 'install'])
  if (!dotagents.ok) return dotagents
  const dotagentsDoctor = runMise(cwd, ['exec', '--', 'dotagents', 'doctor', '--fix'])
  if (!dotagentsDoctor.ok) return dotagentsDoctor

  if (data === undefined || data.targets.includes('lefthook')) {
    const lefthook = runMise(cwd, ['exec', '--', 'lefthook', 'install', '--force'])
    if (!lefthook.ok) return lefthook
  }
  return { ok: true }
}

function pruneRetiredGeneratedPaths(cwd: string): void {
  for (const relPath of RETIRED_GENERATED_PATHS) {
    rmSync(join(cwd, relPath), { recursive: true, force: true })
  }
}

function runMise(cwd: string, args: string[]): OrchestratorResult {
  const result = spawnSync('mise', args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
  })
  if (result.error) {
    return {
      ok: false,
      message: `mise failed to start: ${result.error.message}. Install mise, then rerun this command; project tools are declared in mise.toml.`,
    }
  }
  if (result.status !== 0) {
    return { ok: false, message: `mise ${args.join(' ')} failed with exit code ${result.status ?? -1}` }
  }
  return { ok: true }
}

function refreshCopierSourcePath(cwd: string): void {
  const path = join(cwd, STATE_FILE)
  if (!existsSync(path)) return
  const raw = readFileSync(path, 'utf8')
  if (raw.trimStart().startsWith('{')) {
    const data = JSON.parse(raw) as Record<string, unknown>
    data._src_path = COPIER_TEMPLATE_DIR
    writeFileSync(path, `${JSON.stringify(data)}\n`)
    return
  }
  const srcLine = `_src_path: ${JSON.stringify(COPIER_TEMPLATE_DIR)}`
  if (/^_src_path:/m.test(raw)) {
    writeFileSync(path, raw.replace(/^_src_path:.*$/m, srcLine))
  } else {
    writeFileSync(path, `${srcLine}\n${raw}`)
  }
}

export function applyInternalTemplate(cwd: string, data: TemplateData): void {
  writeGeneratedFile(cwd, 'AGENTS.md', agentsMd(data))
  writeGeneratedFile(cwd, 'CLAUDE.md', claudeMd())
  writeGeneratedFile(cwd, 'agents.toml', agentsToml(data))
  ensureMiseToml(cwd, data)
  ensureLefthookYml(cwd, data)

  if (data.targets.includes('claude')) {
    copyTree(join(COPIER_TEMPLATE_DIR, '.claude', 'hooks'), join(cwd, '.claude', 'hooks'))
    chmodTree(join(cwd, '.claude', 'hooks'))
    writeGeneratedFile(cwd, '.claude/settings.json', JSON.stringify(claudeSettings(data), null, 2) + '\n')
  }

  if (data.targets.includes('codex')) {
    copyTree(join(COPIER_TEMPLATE_DIR, '.codex', 'hooks'), join(cwd, '.codex', 'hooks'))
    chmodTree(join(cwd, '.codex', 'hooks'))
    writeGeneratedFile(cwd, '.codex/hooks.json', JSON.stringify(codexHooks(data), null, 2) + '\n')
  }

  if (data.targets.includes('opencode')) {
    writeGeneratedFile(cwd, '.opencode/plugins/dev-enforcer.ts', opencodePlugin(data))
  }

  if (data.targets.includes('cursor')) {
    writeGeneratedFile(cwd, '.cursor/rules/project.mdc', cursorRule())
  }

  copyTree(join(COPIER_TEMPLATE_DIR, '.agents', 'skills'), join(cwd, '.agents', 'skills'))
  syncSkillLinks(cwd, data)
}

function writeGeneratedFile(cwd: string, relPath: string, content: string): void {
  const absPath = join(cwd, relPath)
  mkdirSync(dirname(absPath), { recursive: true })
  writeFileSync(absPath, content)
}

export function ensureMiseToml(cwd: string, data?: TemplateData): void {
  const path = join(cwd, 'mise.toml')
  if (!existsSync(path)) {
    writeGeneratedFile(cwd, 'mise.toml', miseToml(data ?? defaultMiseTemplateData()))
    return
  }

  const existing = readFileSync(path, 'utf8')
  writeFileSync(path, mergeMiseToolLines(existing, requiredMiseToolLines(data)))
}

export function mergeMiseToolLines(existing: string, requiredLines: string[]): string {
  const lines = existing.split(/\r?\n/)
  const toolsStart = lines.findIndex((line) => line.trim() === '[tools]')
  if (toolsStart === -1) {
    const prefix = ['[tools]', ...requiredLines, ''].join('\n')
    return `${prefix}\n${existing.replace(/^\s+/, '')}`
  }

  let toolsEnd = lines.length
  for (let index = toolsStart + 1; index < lines.length; index += 1) {
    if (/^\s*\[/.test(lines[index])) {
      toolsEnd = index
      break
    }
  }

  const existingKeys = new Set<string>()
  for (const line of lines.slice(toolsStart + 1, toolsEnd)) {
    const key = miseToolKey(line)
    if (key !== null) existingKeys.add(key)
  }

  const missing = requiredLines.filter((line) => {
    const key = miseToolKey(line)
    return key !== null && !existingKeys.has(key)
  })
  if (missing.length === 0) return existing

  lines.splice(toolsStart + 1, 0, ...missing)
  return `${lines.join('\n').replace(/\s+$/, '')}\n`
}

export function ensureLefthookYml(cwd: string, data?: TemplateData): void {
  const path = join(cwd, 'lefthook.yml')
  const templateData = data ?? defaultMiseTemplateData()
  if (!existsSync(path)) {
    writeGeneratedFile(cwd, 'lefthook.yml', lefthookYml(templateData))
    return
  }

  const existing = readFileSync(path, 'utf8')
  writeFileSync(path, mergeLefthookCommands(existing, requiredLefthookCommandBlocks(templateData)))
}

export function mergeLefthookCommands(existing: string, requiredBlocks: Record<string, LefthookCommands>): string {
  const config = parseYamlMap(existing, 'lefthook.yml')
  for (const [hook, commands] of Object.entries(requiredBlocks)) {
    const hookConfig = yamlMap(config[hook])
    const hookCommands = yamlMap(hookConfig.commands)
    for (const [name, command] of Object.entries(commands)) {
      if (hookCommands[name] === undefined) hookCommands[name] = command
    }
    hookConfig.commands = hookCommands
    config[hook] = hookConfig
  }
  return stringify(config)
}

type LefthookCommand = Record<string, unknown>
type LefthookCommands = Record<string, LefthookCommand>

function requiredLefthookCommandBlocks(data: TemplateData): Record<string, LefthookCommands> {
  const commitMsg: LefthookCommands = {
    'conventional-commits': {
      run: [
        "if ! head -1 {1} | grep -qE '^(feat|fix|chore|refactor|test|docs|style|perf|ci|build|revert)(\\([a-z0-9-]+\\))?!?: .+'; then",
        '  echo "Commit message must follow Conventional Commits format."',
        '  exit 1',
        'fi',
      ].join('\n'),
    },
  }
  if (data.beads_enabled) {
    commitMsg['bd-ticket-ref'] = {
      run: [
        'subject=$(head -1 {1})',
        "type=$(echo \"$subject\" | grep -oE '^(feat|fix|chore|refactor|test|docs|style|perf|ci|build|revert)' | head -1)",
        'case "$type" in docs|chore|style) exit 0 ;; esac',
        "if echo \"$subject\" | grep -qE '\\([a-z0-9._-]*[a-z0-9-]+-[a-z0-9._-]+\\)'; then exit 0; fi",
        "if grep -qE '^\\s*Refs:\\s+[a-z0-9_-]+-[a-z0-9._-]+' {1}; then exit 0; fi",
        'echo "Commit references no bd ticket."',
        'exit 1',
      ].join('\n'),
    }
  }

  const preCommit: LefthookCommands = {}
  if (data.commands.typecheck) preCommit.typecheck = { run: 'mise run typecheck' }
  if (data.commands.lint) preCommit.lint = { run: 'mise run lint' }

  const prePush: LefthookCommands = {}
  if (data.commands.test) prePush.test = { run: 'mise run test' }
  if (data.commands.e2e) prePush.e2e = { run: 'mise run e2e' }
  prePush['pr-size-check'] = { run: '.claude/hooks/pr-size-check.sh' }
  prePush.semgrep = {
    run: [
      'if command -v semgrep >/dev/null 2>&1; then',
      '  semgrep --config p/security-audit --config p/owasp-top-ten --error',
      'fi',
    ].join('\n'),
  }

  return {
    'commit-msg': commitMsg,
    'pre-commit': preCommit,
    'pre-push': prePush,
  }
}

function parseYamlMap(source: string, path: string): Record<string, unknown> {
  const parsed = parse(source)
  if (parsed === null) return {}
  if (!isPlainObject(parsed)) throw new Error(`${path} must be a YAML mapping`)
  return parsed
}

function yamlMap(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredMiseToolLines(data?: TemplateData): string[] {
  const lines = [
    '"pipx:copier" = "9.14.0"',
    '"npm:@sentry/dotagents" = "latest"',
    '"aqua:evilmartians/lefthook" = "latest"',
  ]
  if (data?.beads_enabled === true) lines.push('"aqua:steveyegge/beads" = "1.0.2"')
  return lines
}

function miseToolKey(line: string): string | null {
  const match = line.match(/^\s*("[^"]+"|[A-Za-z0-9_.-]+)\s*=/)
  return match?.[1] ?? null
}

function defaultMiseTemplateData(): TemplateData {
  return {
    language: 'other',
    variant: 'other-app',
    languages: ['other'],
    variants: ['other-app'],
    framework: '',
    package_manager: 'other',
    commands: {},
    skills: [],
    tools: [],
    workflow: 'none',
    contract_driven: false,
    targets: [],
    mcp_servers: [],
    models: {},
    beads_enabled: false,
    has_typescript: false,
    has_frontend: false,
  }
}

function copyTree(source: string, dest: string): void {
  if (!existsSync(source)) return
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dirname(dest), { recursive: true })
  cpSync(source, dest, { recursive: true, dereference: false })
}

function chmodTree(dir: string): void {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) chmodTree(path)
    else if (entry.isFile()) chmodSync(path, 0o755)
  }
}

function syncSkillLinks(cwd: string, data: TemplateData): void {
  const toolSkillDirs: string[] = []
  if (data.targets.includes('claude')) toolSkillDirs.push('.claude/skills')
  if (data.targets.includes('codex')) toolSkillDirs.push('.codex/skills')
  if (data.targets.includes('opencode')) toolSkillDirs.push('.opencode/skills')
  if (data.targets.includes('cursor')) toolSkillDirs.push('.cursor/skills')

  const canonical = join(cwd, '.agents', 'skills')
  if (!existsSync(canonical)) return

  const skills = readdirSync(canonical, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  for (const relDir of toolSkillDirs) {
    const absDir = join(cwd, relDir)
    rmSync(absDir, { recursive: true, force: true })
    mkdirSync(absDir, { recursive: true })
    for (const skill of skills) {
      const source = join(canonical, skill.name)
      const target = join(absDir, skill.name)
      const link = relative(absDir, source)
      symlinkSync(link, target, 'dir')
    }
  }
}

export function agentsMd(data: TemplateData): string {
  const lines = [
    '# Project Instructions for AI Agents',
    '',
    'Configured with @oisincoveney/dev. Shared rules live here; reusable playbooks live in `.agents/skills/`; tool-specific runtime wiring lives in native overlays.',
    '',
    '## Critical Rules',
    '',
  ]
  if (data.beads_enabled) {
    lines.push('- Use the tracker workflow for planned work; beads is the first tracker adapter.')
    lines.push('- `/quick [P2|P3] <task>` is the only low-ceremony lane. It still runs in an agent worktree, verifies, commits, and may push/PR when branch rules allow.')
    lines.push('- `/plan [priority] <goal>` creates tracker-backed work in review state and stops. `/approve <id>` unlocks it; `/work-next` executes approved ready work; `/finish` integrates verified work.')
    lines.push('- Tracker data is canonical. Store machine-readable workflow state in tracker metadata (`metadata.workflow` for beads), not disk plan files.')
    lines.push('- Run `bd prime` for workflow context when starting or after compaction.')
    lines.push('- Use `bd remember` for persistent knowledge. Do not create MEMORY.md files.')
    lines.push('- Do not commit `.beads/issues.jsonl`; shared ticket state lives in repo-backed Dolt refs.')
  }
  lines.push('- Never run destructive commands without explicit user approval.')
  lines.push('- Read before editing; verify before claiming done.')
  lines.push('- Say "I need to verify" when uncertain, then check.')
  lines.push('- User constraints are non-negotiable.')
  lines.push('- Do not write "works", "should work", or "done" without running the relevant verification command and seeing it pass.')
  lines.push('- Ask one non-trivial judgment question at a time.')
  lines.push('', '## Commands', '', 'Use `mise run <task>` for canonical project commands.', '')
  for (const [name, command] of Object.entries(data.commands)) {
    lines.push(`- \`mise run ${name}\` -> \`${command}\``)
  }
  lines.push('', '## Tooling', '')
  lines.push('- Skills: `.agents/skills/`, linked into tool-specific locations by @oisincoveney/dev.')
  lines.push('- Git hooks: `lefthook.yml`.')
  lines.push('- Commands/tool versions: `mise.toml`.')
  lines.push('- Runtime overlays: `.claude/`, `.codex/`, `.cursor/`, `.opencode/`.')
  if (data.beads_enabled) {
    lines.push('', '## Beads Quick Reference', '')
    lines.push('```bash')
    lines.push('oisin-dev tracker show <id>')
    lines.push('oisin-dev tracker approve <id>')
    lines.push('bd ready')
    lines.push('bd show <id>')
    lines.push('bd update <id> --claim')
    lines.push('bd close <id> --reason "<why>"')
    lines.push('bd dolt pull')
    lines.push('bd dolt push')
    lines.push('```')
  }
  lines.push('')
  return lines.join('\n')
}

function claudeMd(): string {
  return `# Claude Code Instructions

Read \`AGENTS.md\` first. This file exists only as a Claude-specific entrypoint; shared project policy is canonical in \`AGENTS.md\`.

Claude-specific runtime behavior is configured in \`.claude/settings.json\`.
`
}

function agentsToml(data: TemplateData): string {
  const agentTargets = data.targets.filter((target) => target !== 'lefthook')
  return `version = 1
agents = [${agentTargets.map((target) => JSON.stringify(target)).join(', ')}]

# Generated skills live directly in .agents/skills/ and are linked into
# tool-specific locations by dotagents.
`
}

function miseToml(data: TemplateData): string {
  const lines = ['[tools]']
  if (data.package_manager === 'bun') lines.push('bun = "1.3"')
  lines.push('"pipx:copier" = "9.14.0"')
  lines.push('"npm:@sentry/dotagents" = "latest"')
  lines.push('"aqua:evilmartians/lefthook" = "latest"')
  if (data.beads_enabled) lines.push('"aqua:steveyegge/beads" = "1.0.2"')
  for (const [name, command] of Object.entries(data.commands)) {
    lines.push('', `[tasks.${name}]`)
    lines.push(`run = ${JSON.stringify(command)}`)
  }
  const verify = ['typecheck', 'lint', 'test'].filter((name) => data.commands[name] !== undefined)
  if (verify.length > 0) {
    lines.push('', '[tasks.verify]')
    lines.push(`depends = [${verify.map((name) => JSON.stringify(name)).join(', ')}]`)
  }
  lines.push('')
  return lines.join('\n')
}

function lefthookYml(data: TemplateData): string {
  const blocks = requiredLefthookCommandBlocks(data)
  return `# lefthook.yml — generated by @oisincoveney/dev\n${stringify({
    'commit-msg': { commands: blocks['commit-msg'] },
    'pre-commit': { parallel: true, commands: blocks['pre-commit'] },
    'pre-push': { commands: blocks['pre-push'] },
  })}`
}

function hookCommand(scripts: string[], timeout?: number): { type: 'command'; command: string; timeout?: number } {
  const args = scripts.map((script) => `.claude/hooks/${script}`).join(' ')
  return {
    type: 'command',
    command: `cd "$(git rev-parse --show-toplevel)" && PATH="$PWD/.claude/hooks/bin:$PATH" .claude/hooks/run-quiet.sh ${args}`,
    ...(timeout === undefined ? {} : { timeout }),
  }
}

function claudeSettings(data: TemplateData): Record<string, unknown> {
  const preToolEnv = [
    data.beads_enabled ? 'OISIN_DEV_BEADS=1' : '',
    data.has_typescript ? 'OISIN_DEV_TYPESCRIPT=1' : '',
  ].filter(Boolean).join(' ')
  const preToolPrefix = preToolEnv.length > 0 ? `${preToolEnv} ` : ''
  const stopScripts = [
    'worktree-stop-guard.sh',
    ...(data.beads_enabled ? ['swarm-digest.sh'] : []),
    'post-edit-await.sh',
    'pre-stop-verification.sh',
    'verifier-skill-guard.sh',
    'baseline-compare.sh',
    'citation-check.sh',
    'ai-antipattern-guard.sh',
  ]
  const verificationAllowPattern = [
    data.commands.typecheck,
    data.commands.lint,
    data.commands.test,
    'git status',
    'git diff',
    'git log',
    'bd *',
  ].filter((cmd): cmd is string => typeof cmd === 'string' && cmd.length > 0).join('|')
  return {
    hooks: {
      SessionStart: [{ hooks: [hookCommand(['context-bootstrap.sh', 'baseline-pin.sh'], 120)] }],
      UserPromptSubmit: [{ hooks: [hookCommand([data.beads_enabled ? 'bd-context-inject.sh' : 'context-injector.sh'], 5)] }],
      PreToolUse: [{
        hooks: [{
          type: 'command',
          command: `cd "$(git rev-parse --show-toplevel)" && PATH="$PWD/.claude/hooks/bin:$PATH" ${preToolPrefix}.claude/hooks/pre-tool-dispatch.sh`,
          timeout: 30,
        }],
      }],
      PostToolUse: [{ matcher: 'Write|Edit', hooks: [hookCommand(['post-edit-async.sh', 'ai-antipattern-guard.sh'], 10)] }],
      Stop: [{ hooks: [hookCommand(stopScripts, 120)] }],
      PreCompact: [{ hooks: [hookCommand(['pre-compact-prime.sh'], 10)] }],
    },
    statusLine: {
      type: 'command',
      command: 'cd "$(git rev-parse --show-toplevel)" && .claude/hooks/statusline.sh',
    },
    permissions: {
      mode: 'default',
      rules: [
        { tool: 'Bash', decision: 'deny', if: 'Bash(rm -rf|git reset --hard)', reason: 'Destructive commands require explicit user approval' },
        { tool: 'Read', decision: 'allow', reason: 'Read-only file access' },
        { tool: 'Glob', decision: 'allow', reason: 'Read-only search' },
        { tool: 'Grep', decision: 'allow', reason: 'Read-only search' },
        { tool: 'Bash', decision: 'allow', if: `Bash(${verificationAllowPattern})`, reason: 'Safe verification and task tracking' },
        { tool: 'Bash', decision: 'ask', if: 'Bash(git commit*|git push*)', reason: 'Git operations require review' },
        { tool: 'Edit', decision: 'ask', reason: 'Code changes require approval' },
        { tool: 'Write', decision: 'ask', reason: 'File creation requires approval' },
      ],
    },
  }
}

function codexHooks(data: TemplateData): Record<string, unknown> {
  const settings = claudeSettings(data) as { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> }
  const hooks = JSON.parse(JSON.stringify(settings.hooks)) as Record<string, Array<{ hooks: Array<{ command: string }> }>>
  for (const entries of Object.values(hooks)) {
    for (const entry of entries) {
      for (const hook of entry.hooks) hook.command = hook.command.replaceAll('.claude/', '.codex/')
    }
  }
  return { hooks }
}

function cursorRule(): string {
  return `---
description: Shared project rules for AI coding agents
globs: ["**/*"]
---

# Project Rules

Use \`AGENTS.md\` as the canonical project instruction file. Skills live in \`.agents/skills/\` and are linked into tool-specific locations by @oisincoveney/dev.
`
}

function opencodePlugin(data: TemplateData): string {
  return `// dev-enforcer.ts — generated by @oisincoveney/dev
// OpenCode overlay. Shared policy lives in AGENTS.md; hook behavior delegates to .claude/hooks.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

interface ToolEvent {
  tool: string
  input: Record<string, unknown>
}

const HOOKS_DIR = '.claude/hooks'
const HAS_TYPESCRIPT = ${JSON.stringify(data.has_typescript)}
const BEADS_ENABLED = ${JSON.stringify(data.beads_enabled)}

function toolKey(tool: string): string {
  return tool.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
}

function runHook(name: string, input: unknown): { allowed: boolean; message?: string } {
  const path = join(HOOKS_DIR, name)
  if (!existsSync(path)) return { allowed: true }
  const result = spawnSync(path, [], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    timeout: 30_000,
  })
  if (result.status === 2) return { allowed: false, message: result.stderr || 'Blocked by hook' }
  return { allowed: true }
}

function runDispatchedHook(name: string, input: unknown): { allowed: boolean; message?: string } {
  const result = spawnSync('oisin-dev', ['hook', name], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    timeout: 30_000,
  })
  if (result.status === 2) return { allowed: false, message: result.stderr || 'Blocked by hook' }
  return { allowed: true }
}

export default {
  name: 'dev-enforcer',
  async 'tool.execute.before'(event: ToolEvent): Promise<void> {
    const key = toolKey(event.tool)
    const toolInput = { tool_name: event.tool, tool_input: event.input }

    if (key.includes('todo')) {
      const block = runHook('block-todowrite.sh', toolInput)
      if (!block.allowed) throw new Error(block.message)
      return
    }

    if (key.includes('bash') || key.includes('shell') || key.includes('exec')) {
      const destructive = runHook('destructive-command-guard.sh', toolInput)
      if (!destructive.allowed) throw new Error(destructive.message)
      const coauthor = runDispatchedHook('block-coauthor', toolInput)
      if (!coauthor.allowed) throw new Error(coauthor.message)
      return
    }

    if (key.includes('write') || key.includes('edit') || key.includes('patch')) {
      const worktree = runHook('worktree-write-guard.sh', toolInput)
      if (!worktree.allowed) throw new Error(worktree.message)
      void BEADS_ENABLED
      if (HAS_TYPESCRIPT) {
        const style = runHook('ts-style-guard.sh', toolInput)
        if (!style.allowed) throw new Error(style.message)
        const imports = runHook('import-validator.sh', toolInput)
        if (!imports.allowed) throw new Error(imports.message)
      }
      const antipattern = runHook('ai-antipattern-guard.sh', toolInput)
      if (!antipattern.allowed) throw new Error(antipattern.message)
    }
  },
}
`
}
