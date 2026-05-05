/**
 * Installs hooks, configs, skills, and instruction files into the target directory.
 * Reads from templates/ and writes to the project, and runs side-effect installs
 * (bd init, beads plugin, MCP servers, GSD/IDD toolkits).
 */

import { execSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as p from '@clack/prompts'
import type { DevConfig } from './config.js'
import {
  applyManagedFiles,
  type ApplyManagedFilesResult,
  seedManifestFromKnownFiles,
} from './manifest.js'
import type { Answers } from './prompts.js'
import { buildClaudeMdBundle } from './generate/markdown.js'
import { generateClaudeSettings } from './generate/claude-settings.js'
import { generateCodexHooks } from './generate/codex-hooks.js'
import { generateCursorRules } from './generate/cursor-rules.js'
import { generateLefthook } from './generate/lefthook.js'
import { generateLintConfig } from './generate/lint-config.js'
import { generateCommands } from './generate/commands.js'
import { generateOpencodePlugin } from './generate/opencode-plugin.js'
import { generateRules } from './generate/rules.js'
import { generateToolConfigs } from './generate/tool-configs.js'
import { SUPERPOWER_SKILLS, type SuperpowerSkill } from './skills.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const TEMPLATES_DIR = resolve(__dirname, '..', 'templates')

export interface InstallOptions {
  /** Skip side effects like bd init, MCP registration, plugin installs. Used by tests. */
  skipSideEffects?: boolean
  /** Update mode: merge settings instead of overwriting, skip lefthook and lint/tool configs. */
  isUpdate?: boolean
  /** Override lefthook.yml drift on update (caller has explicitly opted in). */
  acceptLefthookOverwrite?: boolean
  /** Interactive drift handler — invoked per drifted file on update. When omitted, update writes .dev-new sidecars. */
  onDrift?: import('./manifest.js').DriftHandler
}

export interface InstallResult {
  manifest?: ApplyManagedFilesResult
}

export async function installAll(
  cwd: string,
  config: DevConfig,
  answers: Answers,
  options: InstallOptions = {},
): Promise<InstallResult> {
  const installResult: InstallResult = {}
  const log = (msg: string): void => {
    // biome-ignore lint: CLI output
    console.log(`  ✓ ${msg}`)
  }
  const warn = (msg: string): void => {
    // biome-ignore lint: CLI output
    console.log(`  ⚠ ${msg}`)
  }

  // ─── File generation: gather everything, apply via manifest ────────

  if (config.targets.includes('claude')) {
    const seed = seedManifestFromKnownFiles(cwd, getPackageVersion())
    if (seed.seeded) {
      log(`seeded manifest from ${seed.fileCount} prior-version files`)
    }
  }

  const allFiles = gatherAllManagedFiles({ cwd, config, answers, options, warn })
  installResult.manifest = await applyManagedFiles(cwd, {
    version: getPackageVersion(),
    files: allFiles,
    mode: options.isUpdate ? 'update' : 'init',
    acceptLefthookOverwrite: options.acceptLefthookOverwrite,
    onDrift: options.onDrift,
  })

  if (config.targets.includes('claude')) {
    chmodHooksDir(join(cwd, '.claude', 'hooks'))
    log('.claude/hooks/ (chmod +x)')

    const settingsPath = join(cwd, '.claude', 'settings.json')
    const generatedSettings = generateClaudeSettings(config)
    if (options.isUpdate) {
      writeOrMergeSettings(settingsPath, generatedSettings, log)
    } else {
      writeJson(settingsPath, generatedSettings)
      log('.claude/settings.json')
    }

    appendToGitignore(cwd, '.claude/audit.jsonl')
  }
  if (config.targets.includes('codex')) {
    chmodHooksDir(join(cwd, '.codex', 'hooks'))
    log('.codex/hooks/ (chmod +x)')
  }

  // CLAUDE.md and AGENTS.md are hybrid (managed block + user content). They
  // keep writeOrMerge semantics rather than going through the manifest, which
  // would treat user-added content outside the managed block as drift.
  const bundle = buildClaudeMdBundle(config, answers)
  writeOrMerge(join(cwd, 'CLAUDE.md'), bundle.root, log)
  writeOrMerge(join(cwd, 'AGENTS.md'), bundle.root, log)

  // ─── Side-effect installs ───────────────────────────────────────────

  // Strip scope-guard unconditionally — it false-positives on read commands
  // whose paths contain "install" and caches a stale projectRoot per pid.
  // Runs on update too (skipSideEffects=true) so users get the fix without
  // a full reinstall of grounded.
  if (config.targets.includes('claude')) {
    pruneScopeGuardHook(join(homedir(), '.claude', 'settings.json'), log, warn)
  }

  if (options.skipSideEffects) return installResult

  if (config.targets.includes('claude')) {
    installGroundedHooks(cwd, log, warn)
  }

  if (config.tools.includes('beads')) {
    const cliResult = installBeadsCli(cwd)
    switch (cliResult.status) {
      case 'created':
        log('beads: bd init')
        break
      case 'exists':
        log('beads: .beads/ already exists, skipping bd init')
        break
      case 'no-bd':
        warn(
          'beads: `bd` not found in PATH. Install: curl -sSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh | bash',
        )
        break
      case 'failed':
        warn(`beads: bd init failed (${cliResult.error})`)
        break
    }

    if (cliResult.status === 'created' || cliResult.status === 'exists') {
      const configureResult = configureBeadsAfterInit(cwd)
      if (configureResult.ok) {
        log('beads: validation.on-create=warn, hooks installed')
      } else {
        warn(`beads: post-init configuration failed (${configureResult.error})`)
      }

      if (config.workflow === 'bd') {
        const seedResult = seedConstitutionDecisions(cwd, config)
        if (seedResult.ok) {
          if (seedResult.created > 0) {
            log(`beads: seeded ${seedResult.created} constitution decision(s)`)
          } else {
            log('beads: constitution already seeded')
          }
        } else {
          warn(`beads: constitution seeding failed (${seedResult.error})`)
        }
      }
    }

    const pluginResult = installBeadsPlugin(cwd)
    switch (pluginResult.status) {
      case 'installed':
        log('beads: Claude Code plugin installed')
        break
      case 'already-installed':
        log('beads: Claude Code plugin already installed')
        break
      case 'no-claude':
        warn('beads plugin: `claude` CLI not in PATH, skipping plugin install')
        break
      case 'failed':
        warn(`beads plugin install failed (${pluginResult.error})`)
        break
    }
  }

  if (config.targets.includes('claude') && answers.mcpServers.length > 0) {
    installMcpServers(cwd, answers.mcpServers, log, warn)
  }

  // GSD and IDD workflows have been removed. The bd-native workflow is the
  // only supported flavor; readConfig coerces legacy "gsd" / "idd" values to
  // "none" with a deprecation warning.

  return installResult
}

function getPackageVersion(): string {
  const pkgPath = resolve(__dirname, '..', 'package.json')
  const raw = readFileSync(pkgPath, 'utf8')
  const pkg = JSON.parse(raw) as { version: string }
  return pkg.version
}

/** Hook script base names migrated to the TS dispatcher. Mirrors
 * MIGRATED_HOOKS in src/generate/claude-settings.ts. The `.sh` files are
 * skipped during install so the legacy shell version stops shipping. */
const MIGRATED_HOOK_SCRIPTS = new Set<string>([
  'ai-antipattern-guard.sh',
  'audit-log.sh',
  'banned-words-guard.sh',
  'baseline-compare.sh',
  'baseline-pin.sh',
  'bd-context-inject.sh',
  'bd-create-gate.sh',
  'bd-remember-protect.sh',
  'block-coauthor.sh',
  'block-todowrite.sh',
  'citation-check.sh',
  'context-bootstrap.sh',
  'context-injector.sh',
  'destructive-command-guard.sh',
  'docs-first.sh',
  'import-validator.sh',
  'plan-approval-guard.sh',
  'post-edit-check.sh',
  'pre-compact-prime.sh',
  'pre-stop-verification.sh',
  'require-claim.sh',
  'require-swarm.sh',
  'swarm-digest.sh',
  'ts-style-guard.sh',
  'verifier-skill-guard.sh',
  'worktree-stop-guard.sh',
  'worktree-write-guard.sh',
])

function gatherClaudeHooks(): Map<string, string> {
  const srcDir = join(TEMPLATES_DIR, 'hooks')
  const files = new Map<string, string>()
  walkDirIntoMap(srcDir, '.claude/hooks', files)
  for (const key of [...files.keys()]) {
    const base = key.split('/').pop() ?? key
    if (MIGRATED_HOOK_SCRIPTS.has(base)) {
      files.delete(key)
    }
  }
  return files
}

function chmodHooksDir(dir: string): void {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name)
    if (entry.isDirectory()) {
      chmodHooksDir(child)
    } else if (entry.isFile()) {
      chmodSync(child, 0o755)
    }
  }
}

function walkDirIntoMap(
  srcAbs: string,
  destPrefix: string,
  out: Map<string, string>,
  transform?: (relPath: string, content: string) => string,
): void {
  if (!existsSync(srcAbs)) return
  for (const entry of readdirSync(srcAbs, { withFileTypes: true })) {
    const childSrc = join(srcAbs, entry.name)
    const childDest = `${destPrefix}/${entry.name}`
    if (entry.isDirectory()) {
      walkDirIntoMap(childSrc, childDest, out, transform)
    } else if (entry.isFile()) {
      const content = readFileSync(childSrc, 'utf8')
      out.set(childDest, transform ? transform(childDest, content) : content)
    }
  }
}

function stampSkillFrontmatterContent(
  content: string,
  skill: SuperpowerSkill,
  warn: (msg: string) => void,
): string {
  let front: Record<string, string> = {}
  let body = content
  if (content.startsWith('---\n')) {
    const end = content.indexOf('\n---\n', 4)
    if (end !== -1) {
      const yaml = content.slice(4, end)
      body = content.slice(end + 5)
      for (const line of yaml.split('\n')) {
        const match = line.match(/^([a-zA-Z_-]+):\s*(.*)$/)
        if (match) front[match[1]] = match[2]
      }
    }
  }
  if (skill.classification === 'reference') {
    front['disable-model-invocation'] = 'true'
    front['user-invocable'] = 'false'
  } else if (skill.classification === 'action') {
    front['disable-model-invocation'] = 'true'
  }
  if (skill.allowedTools && skill.allowedTools.length > 0 && !front['allowed-tools']) {
    front['allowed-tools'] = skill.allowedTools.join(' ')
  }
  if (!front['description'] || front['description'].length < 40) {
    warn(`Skill ${skill.id} has a short or missing description — Claude may not load it.`)
    if (!front['description']) front['description'] = skill.description
  }
  const yamlLines = Object.entries(front).map(([k, v]) => `${k}: ${v}`)
  return `---\n${yamlLines.join('\n')}\n---\n${body}`
}

interface GatherContext {
  cwd: string
  config: DevConfig
  answers: Answers
  options: InstallOptions
  warn: (msg: string) => void
}

export function gatherAllManagedFiles(ctx: GatherContext): Map<string, string> {
  const { config, answers, options, warn } = ctx
  const out = new Map<string, string>()

  if (config.targets.includes('claude')) {
    walkDirIntoMap(join(TEMPLATES_DIR, 'hooks'), '.claude/hooks', out)
    walkDirIntoMap(join(TEMPLATES_DIR, 'skills'), '.claude/skills', out, (relPath, content) => {
      const parts = relPath.split('/')
      if (parts.length === 4 && parts[3] === 'SKILL.md') {
        const skillId = parts[2]
        if (BD_ONLY_SKILLS.has(skillId) && !config.tools.includes('beads')) {
          return content
        }
      }
      return content
    })

    if (config.tools.includes('beads')) {
      out.delete('.claude/skills/to-bd-issues/SKILL.md')
      out.delete('.claude/skills/to-bd-issues/LICENSE')
      out.delete('.claude/skills/spec-verifier/SKILL.md')
      out.delete('.claude/skills/parallel-tickets/SKILL.md')
      out.delete('.claude/skills/plan-brief/SKILL.md')
      walkDirIntoMap(
        join(TEMPLATES_DIR, 'skills', 'to-bd-issues'),
        '.claude/skills/to-bd-issues',
        out,
      )
      walkDirIntoMap(
        join(TEMPLATES_DIR, 'skills', 'spec-verifier'),
        '.claude/skills/spec-verifier',
        out,
      )
      walkDirIntoMap(
        join(TEMPLATES_DIR, 'skills', 'parallel-tickets'),
        '.claude/skills/parallel-tickets',
        out,
      )
      walkDirIntoMap(
        join(TEMPLATES_DIR, 'skills', 'plan-brief'),
        '.claude/skills/plan-brief',
        out,
      )

      walkDirIntoMap(
        join(TEMPLATES_DIR, 'bd'),
        '.beads',
        out,
      )
    } else {
      for (const id of BD_ONLY_SKILLS) {
        for (const key of Array.from(out.keys())) {
          if (key.startsWith(`.claude/skills/${id}/`)) out.delete(key)
        }
      }
    }

    addProjectSkillsToMap(ctx, out)

    for (const rule of generateRules(config, TEMPLATES_DIR)) {
      out.set(`.claude/rules/${rule.filename}`, rule.content)
    }
    for (const cmd of generateCommands(config)) {
      out.set(`.claude/commands/${cmd.filename}`, cmd.content)
    }

  }

  if (config.targets.includes('codex')) {
    walkDirIntoMap(join(TEMPLATES_DIR, 'hooks'), '.codex/hooks', out)
    out.set('.codex/hooks.json', `${JSON.stringify(generateCodexHooks(config), null, 2)}\n`)
  }

  if (config.targets.includes('opencode')) {
    out.set('.opencode/plugins/dev-enforcer.ts', generateOpencodePlugin(config))
  }

  if (config.targets.includes('cursor')) {
    for (const rule of generateCursorRules(config, TEMPLATES_DIR)) {
      out.set(`.cursor/rules/${rule.filename}`, rule.content)
    }
  }

  if (config.targets.includes('lefthook') && !options.isUpdate) {
    out.set('lefthook.yml', generateLefthook(config))
  }

  if (!options.isUpdate) {
    for (const [filename, contents] of Object.entries(generateLintConfig(config))) {
      out.set(filename, contents)
    }
    for (const [filename, contents] of Object.entries(generateToolConfigs(config))) {
      out.set(filename, contents)
    }
  }

  return out
}

function addProjectSkillsToMap(ctx: GatherContext, out: Map<string, string>): void {
  const selectedSuperpowers = SUPERPOWER_SKILLS.filter((s) => ctx.config.skills.includes(s.id))
  if (selectedSuperpowers.length === 0) return
  const globalSkillsDir = join(homedir(), '.agents', 'skills')
  const fallbackDir = join(homedir(), '.claude', 'skills')
  const sourceDir = existsSync(globalSkillsDir)
    ? globalSkillsDir
    : existsSync(fallbackDir)
      ? fallbackDir
      : null
  if (sourceDir === null) {
    ctx.warn(`No global skills directory found. Skipping superpower skill copy.`)
    return
  }
  for (const skill of selectedSuperpowers) {
    const src = join(sourceDir, skill.id)
    if (!existsSync(src)) {
      ctx.warn(`Skill not found in ${sourceDir}: ${skill.id}`)
      continue
    }
    walkDirIntoMap(src, `.claude/skills/${skill.id}`, out, (relPath, content) =>
      relPath.endsWith('/SKILL.md')
        ? stampSkillFrontmatterContent(content, skill, ctx.warn)
        : content,
    )
  }
}

function computeSettingsJsonContent(ctx: GatherContext): string {
  const generated = generateClaudeSettings(ctx.config)
  if (!ctx.options.isUpdate) {
    return `${JSON.stringify(generated, null, 2)}\n`
  }
  const existingPath = join(ctx.cwd, '.claude', 'settings.json')
  if (!existsSync(existingPath)) {
    return `${JSON.stringify(generated, null, 2)}\n`
  }
  try {
    const existingRaw = readFileSync(existingPath, 'utf8')
    const existing = JSON.parse(existingRaw) as Record<string, unknown>
    const merged = mergeClaudeSettings(existing, generated as unknown as Record<string, unknown>)
    return `${JSON.stringify(merged, null, 2)}\n`
  } catch {
    return `${JSON.stringify(generated, null, 2)}\n`
  }
}

function mergeManagedRoot(cwd: string, file: string, managed: string): string {
  const path = join(cwd, file)
  if (!existsSync(path)) return managed
  const existing = readFileSync(path, 'utf8')
  return mergeManagedBlock(existing, managed)
}

function installClaudeHooks(cwd: string, log: (msg: string) => void): void {
  const root = join(cwd, '.claude', 'hooks')
  const stack: string[] = [root]
  while (stack.length > 0) {
    const dir = stack.pop()
    if (dir === undefined) break
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        stack.push(path)
      } else if (entry.isFile()) {
        chmodSync(path, 0o755)
        log(`.claude/hooks/${path.slice(root.length + 1)}`)
      }
    }
  }
}

/**
 * Ensures @pinperepette/grounded is installed and its 11 Claude Code hooks
 * are registered in the user's ~/.claude/settings.json via grounded's own
 * documented install path (`grounded install`). Independent of the target
 * project's language or package manager — works for TS, Rust, Python, Go.
 *
 * Install strategy, in priority order:
 *   1. mise — `mise use npm:@pinperepette/grounded@0.1.0` (writes to the
 *      target's mise.toml, then `mise install`). Polyglot-friendly: matches
 *      how this repo declares `bun` and `bd` (mise.toml).
 *   2. bun  — `bun add -g @pinperepette/grounded`
 *   3. npm  — `npm install -g @pinperepette/grounded`
 *
 * Idempotent: grounded's installer removes prior grounded entries before
 * writing, so re-running this on every `oisin-dev install` is safe.
 */
function installGroundedHooks(
  cwd: string,
  log: (msg: string) => void,
  warn: (msg: string) => void,
): void {
  if (!commandExists('grounded')) {
    if (commandExists('mise')) {
      const use = spawnSync(
        'mise',
        ['use', '--quiet', 'npm:@pinperepette/grounded@0.1.0'],
        { cwd, stdio: 'pipe', encoding: 'utf8' },
      )
      if (use.status !== 0) {
        warn(`grounded: mise use failed: ${use.stderr || use.stdout}`)
        return
      }
    } else if (commandExists('bun')) {
      const inst = spawnSync('bun', ['add', '-g', '@pinperepette/grounded'], {
        stdio: 'pipe',
        encoding: 'utf8',
      })
      if (inst.status !== 0) {
        warn(`grounded: bun add -g failed: ${inst.stderr || inst.stdout}`)
        return
      }
    } else if (commandExists('npm')) {
      const inst = spawnSync('npm', ['install', '-g', '@pinperepette/grounded'], {
        stdio: 'pipe',
        encoding: 'utf8',
      })
      if (inst.status !== 0) {
        warn(`grounded: npm install -g failed: ${inst.stderr || inst.stdout}`)
        return
      }
    } else {
      warn('grounded: none of mise, bun, or npm in PATH — skipping grounded hooks')
      return
    }
  }
  // `mise use` only configures the tool; the binary may still need to be
  // resolved through `mise exec` if it's not yet on the active PATH. Try a
  // direct `grounded install` first; on failure, retry via mise exec.
  const direct = spawnSync('grounded', ['install'], { cwd, stdio: 'pipe', encoding: 'utf8' })
  if (direct.status === 0) {
    log('@pinperepette/grounded hooks → ~/.claude/settings.json')
    pruneScopeGuardHook(join(homedir(), '.claude', 'settings.json'), log, warn)
    return
  }
  if (commandExists('mise')) {
    const viaMise = spawnSync('mise', ['exec', '--', 'grounded', 'install'], {
      cwd,
      stdio: 'pipe',
      encoding: 'utf8',
    })
    if (viaMise.status === 0) {
      log('@pinperepette/grounded hooks → ~/.claude/settings.json (via mise exec)')
      pruneScopeGuardHook(join(homedir(), '.claude', 'settings.json'), log, warn)
      return
    }
    warn(`grounded install failed (direct + mise exec): ${viaMise.stderr || viaMise.stdout}`)
    return
  }
  warn(`grounded install failed: ${direct.stderr || direct.stdout}`)
}

/**
 * Removes grounded's scope-guard PreToolUse entry from ~/.claude/settings.json.
 *
 * scope-guard's Bash matcher uses a write-verb regex that includes `\binstall\b`,
 * which false-positives on read commands whose paths contain "install" (e.g.
 * anything under ~/.bun/install/...). It also caches projectRoot per-pid in
 * /tmp and never refreshes, so worktree-relocated sessions get blocked on
 * legitimate writes. Until grounded fixes both, we strip it after every
 * `grounded install`. The remaining 10 hooks stay registered.
 */
interface ClaudeSettings {
  hooks?: {
    PreToolUse?: Array<{ hooks?: Array<{ command?: string }> }>
    [key: string]: unknown
  }
  [key: string]: unknown
}

export function pruneScopeGuardHook(
  settingsPath: string,
  log: (msg: string) => void,
  warn: (msg: string) => void,
): boolean {
  if (!existsSync(settingsPath)) return false
  let settings: ClaudeSettings
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as ClaudeSettings
  } catch (e) {
    warn(`scope-guard prune: ${settingsPath} is not valid JSON: ${(e as Error).message}`)
    return false
  }
  const pre = settings.hooks?.PreToolUse
  if (!pre) return false
  const filtered = pre.filter(
    (entry) => !(entry.hooks ?? []).some((h) => h.command?.includes('scope-guard.js')),
  )
  if (filtered.length === pre.length) return false
  settings.hooks = { ...settings.hooks, PreToolUse: filtered }
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
  log('removed scope-guard from ~/.claude/settings.json')
  return true
}

function installCodexHooks(cwd: string, log: (msg: string) => void): void {
  const srcDir = join(TEMPLATES_DIR, 'hooks')
  const destDir = join(cwd, '.codex', 'hooks')
  mkdirSync(destDir, { recursive: true })
  for (const file of readdirSync(srcDir)) {
    const src = join(srcDir, file)
    const dest = join(destDir, file)
    copyFileSync(src, dest)
    chmodSync(dest, 0o755)
    log(`.codex/hooks/${file}`)
  }
}

function installProjectSkills(
  cwd: string,
  config: DevConfig,
  log: (msg: string) => void,
  warn: (msg: string) => void,
): void {
  const selectedSuperpowers = SUPERPOWER_SKILLS.filter((s) => config.skills.includes(s.id))
  if (selectedSuperpowers.length === 0) return

  const globalSkillsDir = join(homedir(), '.agents', 'skills')
  const fallbackDir = join(homedir(), '.claude', 'skills')
  const sourceDir = existsSync(globalSkillsDir)
    ? globalSkillsDir
    : existsSync(fallbackDir)
      ? fallbackDir
      : null

  if (sourceDir === null) {
    warn(
      `No global skills directory found (${globalSkillsDir} or ${fallbackDir}). Skipping skill copy.`,
    )
    return
  }

  const destRoot = join(cwd, '.claude', 'skills')
  mkdirSync(destRoot, { recursive: true })

  for (const skill of selectedSuperpowers) {
    const src = join(sourceDir, skill.id)
    if (!existsSync(src)) {
      warn(`Skill not found in ${sourceDir}: ${skill.id}`)
      continue
    }
    const dest = join(destRoot, skill.id)
    cpSync(src, dest, { recursive: true, dereference: true })
    stampSkillFrontmatter(join(dest, 'SKILL.md'), skill, warn)
    log(`.claude/skills/${skill.id}/`)
  }
}

/**
 * Installs skills owned by this package (currently just `policies`).
 * These are always copied, regardless of superpower selection, because
 * they're referenced by the kernel CLAUDE.md.
 */
const BD_ONLY_SKILLS = new Set<string>([
  'to-bd-issues',
  'spec-verifier',
  'parallel-tickets',
  'plan-brief',
])

function installOwnedSkills(
  cwd: string,
  config: DevConfig,
  log: (msg: string) => void,
): void {
  const srcDir = join(TEMPLATES_DIR, 'skills')
  if (!existsSync(srcDir)) return
  const destRoot = join(cwd, '.claude', 'skills')
  mkdirSync(destRoot, { recursive: true })
  const beadsEnabled = config.tools.includes('beads')
  for (const entry of readdirSync(srcDir)) {
    if (BD_ONLY_SKILLS.has(entry) && !beadsEnabled) continue
    const src = join(srcDir, entry)
    const dest = join(destRoot, entry)
    cpSync(src, dest, { recursive: true, dereference: true })
    log(`.claude/skills/${entry}/`)
  }
}

/**
 * Ensures SKILL.md frontmatter reflects the skill's classification:
 * - reference: sets `disable-model-invocation: true` and `user-invocable: false`
 * - action:    sets `disable-model-invocation: true`
 * - workflow:  default (both invocable) + optional `allowed-tools`
 *
 * Does not touch the skill body. Existing frontmatter fields are preserved
 * unless we're explicitly overriding them.
 */
function stampSkillFrontmatter(
  path: string,
  skill: SuperpowerSkill,
  warn: (msg: string) => void,
): void {
  if (!existsSync(path)) {
    warn(`Skill has no SKILL.md: ${skill.id}`)
    return
  }
  const raw = readFileSync(path, 'utf8')
  let front: Record<string, string> = {}
  let body = raw
  if (raw.startsWith('---\n')) {
    const end = raw.indexOf('\n---\n', 4)
    if (end !== -1) {
      const yaml = raw.slice(4, end)
      body = raw.slice(end + 5)
      for (const line of yaml.split('\n')) {
        const match = line.match(/^([a-zA-Z_-]+):\s*(.*)$/)
        if (match) front[match[1]] = match[2]
      }
    }
  }

  if (skill.classification === 'reference') {
    front['disable-model-invocation'] = 'true'
    front['user-invocable'] = 'false'
  } else if (skill.classification === 'action') {
    front['disable-model-invocation'] = 'true'
  }
  if (skill.allowedTools && skill.allowedTools.length > 0 && !front['allowed-tools']) {
    front['allowed-tools'] = skill.allowedTools.join(' ')
  }

  if (!front['description'] || front['description'].length < 40) {
    warn(
      `Skill ${skill.id} has a short or missing description — Claude may not load it when relevant.`,
    )
    if (!front['description']) {
      front['description'] = skill.description
    }
  }

  const yamlLines = Object.entries(front).map(([k, v]) => `${k}: ${v}`)
  writeFileSync(path, `---\n${yamlLines.join('\n')}\n---\n${body}`)
}

/**
 * Run an external command with a HARD timeout enforced via SIGKILL and the
 * child attached to the parent's TTY so Ctrl-C reaches it via the process
 * group. Returns a typed result.
 *
 * Why this exists (vs `execSync`):
 * - `execSync({ timeout })` sends SIGTERM, which a misbehaving child can
 *   catch and ignore — the parent then waits indefinitely. We use SIGKILL,
 *   which is uncatchable.
 * - `execSync` runs the child detached from the controlling TTY; SIGINT
 *   from a `Ctrl-C` press doesn't reach the child process group. With
 *   `stdio: 'inherit'` the child shares the parent's TTY and is part of
 *   its foreground process group, so the kernel delivers SIGINT to it
 *   directly when the user hits Ctrl-C.
 *
 * Reasons a child would otherwise hang past `execSync`'s timeout in this
 * codebase: `bd init` blocked on a global `core.hooksPath` hook calling
 * back into `bd` while bd holds the dolt lock, and `claude plugin install`
 * stalling on a remote network call.
 */
type RunResult =
  | { ok: true }
  | { ok: false; reason: 'exit'; code: number }
  | { ok: false; reason: 'timeout'; afterMs: number }
  | { ok: false; reason: 'signal'; signal: NodeJS.Signals }
  | { ok: false; reason: 'spawn-error'; message: string }

interface RunOptions {
  cwd: string
  timeoutMs: number
  env?: NodeJS.ProcessEnv
}

export function runCommand(
  cmd: string,
  args: ReadonlyArray<string>,
  opts: RunOptions,
): RunResult {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    stdio: 'inherit',
    timeout: opts.timeoutMs,
    killSignal: 'SIGKILL',
  })
  if (result.error) {
    // Distinguish timeout (which spawnSync surfaces as ETIMEDOUT) from
    // genuine spawn failures (binary not found, permission denied, etc.).
    const errno = (result.error as NodeJS.ErrnoException).code
    if (errno === 'ETIMEDOUT') {
      return { ok: false, reason: 'timeout', afterMs: opts.timeoutMs }
    }
    return { ok: false, reason: 'spawn-error', message: result.error.message }
  }
  if (result.signal) {
    return { ok: false, reason: 'signal', signal: result.signal }
  }
  if (result.status === 0) return { ok: true }
  return { ok: false, reason: 'exit', code: result.status ?? -1 }
}

function runFailureMessage(r: RunResult & { ok: false }): string {
  switch (r.reason) {
    case 'exit':
      return `exit code ${r.code}`
    case 'timeout':
      return `timed out after ${r.afterMs}ms (SIGKILL)`
    case 'signal':
      return `killed by ${r.signal}`
    case 'spawn-error':
      return r.message
  }
}

/**
 * Result of attempting to initialise beads in a project directory.
 * Distinct cases let callers (and tests) reason about each terminal state
 * explicitly rather than parsing log strings.
 */
export type BeadsCliResult =
  | { status: 'created' }
  | { status: 'exists' }
  | { status: 'no-bd' }
  | { status: 'failed'; error: string }

/**
 * Initialise beads in `cwd`. Returns a structured result instead of taking
 * log/warn callbacks so callers (and tests) decide how to surface the outcome.
 *
 * `bd init` triggers a `git commit` for the new `.beads/` files. If the user
 * has `core.hooksPath` set globally (which beads' own setup configures, so
 * this is common for bd users) those global hooks fire on every git commit —
 * including the one inside bd init. Each global hook calls back into `bd`,
 * but bd is still holding the dolt DB lock, so `bd hooks run` blocks waiting
 * for it and the commit hangs indefinitely.
 *
 * Fix: neutralise git hooks for ONLY this `bd init` invocation by setting
 * `core.hooksPath=/dev/null` via `GIT_CONFIG_PARAMETERS`. This affects only
 * the subprocess; the user's global config and the repo's own `.git/config`
 * are untouched, so bd's hook integration (which `bd init` writes into the
 * repo's `.git/config`) works for every subsequent commit. We get full beads
 * functionality with no deadlock and no timeout reliance.
 *
 * `--non-interactive` is auto-detected when stdin isn't a TTY (our case under
 * execSync), but set explicitly to pin the contract.
 */
export function installBeadsCli(cwd: string): BeadsCliResult {
  if (existsSync(join(cwd, '.beads'))) return { status: 'exists' }
  if (!commandExists('bd')) return { status: 'no-bd' }
  const r = runCommand('bd', ['init', '--non-interactive'], {
    cwd,
    timeoutMs: 60_000,
    env: {
      ...process.env,
      GIT_CONFIG_PARAMETERS: "'core.hooksPath=/dev/null'",
    },
  })
  if (r.ok) return { status: 'created' }
  return { status: 'failed', error: runFailureMessage(r) }
}

export type BeadsConfigureResult = { ok: true } | { ok: false; error: string }

export function configureBeadsAfterInit(cwd: string): BeadsConfigureResult {
  if (!commandExists('bd')) return { ok: false, error: 'bd not in PATH' }
  if (!existsSync(join(cwd, '.beads'))) return { ok: false, error: '.beads/ does not exist' }

  const validation = runCommand('bd', ['config', 'set', 'validation.on-create', 'warn'], {
    cwd,
    timeoutMs: 10_000,
  })
  if (!validation.ok) return { ok: false, error: runFailureMessage(validation) }

  const hooks = runCommand('bd', ['hooks', 'install'], {
    cwd,
    timeoutMs: 30_000,
  })
  if (!hooks.ok && hooks.reason !== 'exit') {
    return { ok: false, error: runFailureMessage(hooks) }
  }

  for (const file of ['AGENTS.md', 'CLAUDE.md']) {
    const path = join(cwd, file)
    if (existsSync(path)) {
      trimBeadsIntegrationBlock(path)
    }
  }

  return { ok: true }
}

export type SeedConstitutionResult =
  | { ok: true; created: number }
  | { ok: false; error: string }

export function seedConstitutionDecisions(
  cwd: string,
  config: DevConfig,
): SeedConstitutionResult {
  if (!commandExists('bd')) return { ok: false, error: 'bd not in PATH' }
  if (!existsSync(join(cwd, '.beads'))) return { ok: false, error: '.beads/ does not exist' }

  const list = spawnSync('bd', ['list', '--type=decision', '--status', 'all', '--json'], {
    cwd,
    encoding: 'utf8',
    timeout: 10_000,
  })

  const existingTitles = new Set<string>()
  if (list.status === 0 && list.stdout) {
    try {
      const issues = JSON.parse(list.stdout) as Array<{ title?: string }>
      for (const issue of issues) {
        if (issue.title) existingTitles.add(issue.title)
      }
    } catch {
      // Fall through; treat as no existing decisions.
    }
  }

  const decisions: Array<{ title: string; body: string }> = [
    {
      title: `Constitution: package manager is ${config.packageManager}`,
      body: `## Decision\nUse \`${config.packageManager}\` for all dependency management commands.\n\n## Rationale\nDocumented in .dev.config.json. Hooks normalize alternative invocations.\n\n## Alternatives Considered\nnpm, pnpm, yarn — rejected per project choice.`,
    },
    {
      title: `Constitution: test command is ${config.commands.test ?? 'unset'}`,
      body: `## Decision\nThe canonical test command is \`${config.commands.test ?? 'unset'}\`. Pre-stop verification matches against this string.\n\n## Rationale\nExplicit single-source command keeps proof-of-work checks deterministic.\n\n## Alternatives Considered\nMultiple test runners — rejected to keep the verification gate simple.`,
    },
    {
      title: 'Constitution: destructive ops require explicit user approval',
      body: '## Decision\nNever run destructive commands without explicit user approval. The destructive-command-guard hook enforces this; salvageable cases are rewritten rather than denied.\n\n## Rationale\nIrreversible actions need a human in the loop.\n\n## Alternatives Considered\nFully autonomous — rejected; blast radius of mistakes is too high.',
    },
    {
      title: 'Constitution: no follow-up questions in agent output',
      body: '## Decision\nAgent responses must not end with follow-up prompts. The banned-words guard enforces this on Stop.\n\n## Rationale\nFollow-up questions force the user to opt out of unsolicited work; net negative on flow.\n\n## Alternatives Considered\nGuide via prompt only — rejected; agents drift.',
    },
    {
      title: 'Constitution: no completion claims without proof',
      body: '## Decision\nNever claim completion without having executed the configured test command this session. Pre-stop-verification hook enforces this.\n\n## Rationale\nUnverified claims are the most expensive failure mode.\n\n## Alternatives Considered\nAdvisory rule only — rejected; agents skip the run.',
    },
  ]

  let created = 0
  for (const decision of decisions) {
    if (existingTitles.has(decision.title)) continue
    const create = spawnSync(
      'bd',
      [
        'create',
        '--type=decision',
        '--priority=0',
        `--title=${decision.title}`,
        '--silent',
        '--body-file=-',
      ],
      {
        cwd,
        encoding: 'utf8',
        timeout: 10_000,
        input: decision.body,
      },
    )
    if (create.status !== 0) {
      return {
        ok: false,
        error: `Failed to create decision: ${create.stderr ?? 'unknown error'}`,
      }
    }
    const id = (create.stdout ?? '').trim()
    if (id) {
      spawnSync('bd', ['update', id, '--status', 'pinned'], {
        cwd,
        timeout: 10_000,
      })
    }
    created += 1
  }

  if (created > 0) {
    spawnSync('bd', ['config', 'set', 'validation.on-create', 'error'], {
      cwd,
      timeout: 10_000,
    })
  }

  return { ok: true, created }
}

const LEGACY_RETIRED_PATHS = ['.claude/commands/spec.md', '.claude/specs/TEMPLATE.md']
const WARN_IF_PRESENT = ['.claude/specs', '.claude/plans', 'docs/research']
const REMOVED_CONFIG_FIELDS = ['enforcement', 'beadsWorkflow', 'mcp']

export function removeLegacyRetiredPaths(cwd: string): { removed: string[]; warnings: string[] } {
  const removed: string[] = []
  const warnings: string[] = []

  for (const rel of LEGACY_RETIRED_PATHS) {
    const path = join(cwd, rel)
    if (existsSync(path)) {
      rmSync(path)
      removed.push(rel)
    }
  }

  for (const rel of WARN_IF_PRESENT) {
    const path = join(cwd, rel)
    if (!existsSync(path)) continue
    const entries = readdirSync(path)
    if (entries.length === 0) {
      rmSync(path, { recursive: true })
      removed.push(`${rel}/ (empty)`)
    } else {
      warnings.push(
        `${rel}/ still has ${entries.length} file(s): ${entries.join(', ')} — review and delete manually; bd is the source of truth now.`,
      )
    }
  }

  return { removed, warnings }
}

export function trimBeadsIntegrationOnAgentDocs(cwd: string): string[] {
  const trimmed: string[] = []
  for (const file of ['AGENTS.md', 'CLAUDE.md']) {
    const path = join(cwd, file)
    if (!existsSync(path)) continue
    const before = readFileSync(path, 'utf8')
    trimBeadsIntegrationBlock(path)
    const after = readFileSync(path, 'utf8')
    if (after !== before) {
      trimmed.push(file)
    }
  }
  return trimmed
}

export function stripLegacyConfigFields(cwd: string): string[] {
  const configPath = join(cwd, '.dev.config.json')
  if (!existsSync(configPath)) return []
  const raw = readFileSync(configPath, 'utf8')
  const parsed = JSON.parse(raw) as Record<string, unknown>
  const stripped: string[] = []
  for (const field of REMOVED_CONFIG_FIELDS) {
    if (field in parsed) {
      delete parsed[field]
      stripped.push(field)
    }
  }
  if (stripped.length > 0) {
    writeFileSync(configPath, `${JSON.stringify(parsed, null, 2)}\n`)
  }
  return stripped
}

function appendToGitignore(cwd: string, line: string): void {
  const path = join(cwd, '.gitignore')
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const lines = existing.split(/\r?\n/)
  if (lines.some((l) => l.trim() === line)) return
  const updated = (existing.endsWith('\n') || existing === '' ? existing : `${existing}\n`) + `${line}\n`
  writeFileSync(path, updated)
}

export function trimBeadsIntegrationBlock(path: string): void {
  const raw = readFileSync(path, 'utf8')
  const begin = raw.indexOf('<!-- BEGIN BEADS INTEGRATION')
  const end = raw.indexOf('<!-- END BEADS INTEGRATION -->')
  if (begin === -1 || end === -1) return

  const sessionStart = raw.indexOf('## Session Completion', begin)
  if (sessionStart === -1 || sessionStart > end) return

  const replacement =
    '- Committing is always fine — on a ticket branch, a worktree, or directly on `main`. On a ticket branch or worktree the agent also pushes freely (that\'s the sandbox). Pushing `main` / `master` and any force-push still require explicit user approval.\n'
  const trimmed = raw.slice(0, sessionStart) + replacement + raw.slice(end)
  writeFileSync(path, trimmed)
}

/**
 * Result of attempting to install the beads Claude Code plugin.
 */
export type BeadsPluginResult =
  | { status: 'installed' }
  | { status: 'already-installed' }
  | { status: 'no-claude' }
  | { status: 'failed'; error: string }

/**
 * Install the beads Claude Code plugin via the `claude` CLI. Slow and
 * network-bound (two execSync calls against the plugin marketplace).
 * Returns a structured result. Production caller composes this with
 * `installBeadsCli`; both are independently testable.
 */
export function installBeadsPlugin(cwd: string): BeadsPluginResult {
  if (!commandExists('claude')) return { status: 'no-claude' }
  const marketplace = runCommand(
    'claude',
    ['plugin', 'marketplace', 'add', '--scope', 'project', 'steveyegge/beads'],
    { cwd, timeoutMs: 60_000 },
  )
  if (!marketplace.ok && marketplace.reason !== 'exit') {
    return { status: 'failed', error: runFailureMessage(marketplace) }
  }
  // marketplace add returns non-zero "already added" — that's fine, continue.

  const install = runCommand(
    'claude',
    ['plugin', 'install', '--scope', 'project', 'beads'],
    { cwd, timeoutMs: 60_000 },
  )
  if (install.ok) return { status: 'installed' }
  // claude plugin install returns non-zero for "already installed". With
  // stdio:'inherit' we don't capture stdout to detect that string, so treat
  // any non-timeout, non-signal failure here as already-installed when the
  // marketplace step succeeded — an idempotent re-install matches that.
  if (install.reason === 'exit') return { status: 'already-installed' }
  return { status: 'failed', error: runFailureMessage(install) }
}

function installMcpServers(
  cwd: string,
  servers: ReadonlyArray<string>,
  log: (msg: string) => void,
  warn: (msg: string) => void,
): void {
  if (!commandExists('claude')) {
    warn('MCP: `claude` CLI not in PATH, skipping MCP server registration')
    return
  }

  const mcpCommands: Record<string, string> = {
    memory:
      'claude mcp add memory --scope project -- npx -y @anthropic-ai/mcp-server-memory',
    serena:
      'claude mcp add serena --scope project -- uvx --from git+https://github.com/oraios/serena serena-mcp-server',
    github:
      'claude mcp add github --scope project --transport http https://api.githubcopilot.com/mcp/',
  }

  for (const name of servers) {
    const cmd = mcpCommands[name]
    if (!cmd) {
      warn(`MCP: no install command defined for "${name}"`)
      continue
    }
    try {
      execSync(cmd, { cwd, stdio: 'pipe' })
      log(`MCP: ${name} registered`)
    } catch (err) {
      const msg = (err as Error).message
      if (msg.includes('already')) {
        log(`MCP: ${name} already registered`)
      } else {
        warn(`MCP: ${name} failed (${msg})`)
      }
    }
  }
}

function commandExists(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`)
}

type HookEntry = { matcher?: string; hooks: { type: string; command: string; timeout?: number }[] }

/** Hook scripts that were once shipped but have been retired. Entries are
 * stripped from existing settings.json on update so stale references don't
 * survive the merge. */
const RETIRED_HOOK_SCRIPTS = new Set(['verify-grounding.sh'])

/** Per-event raw hook commands that should be pruned on update. The harness
 * once registered `bd prime` on both SessionStart and PreCompact, but the
 * beads marketplace plugin now owns both events — running both fires bd prime
 * twice and wastes ~1K tokens per cold start (and again per /compact). Both
 * events are pruned because the plugin is the canonical source. */
const RETIRED_HOOK_COMMANDS_BY_EVENT: Record<string, Set<string>> = {
  SessionStart: new Set(['bd prime']),
  PreCompact: new Set(['bd prime']),
}

/** Extracts a stable handler key from a hook command — the value used to
 * dedupe across merges. For legacy `.sh` hooks this is the script filename
 * minus the extension. For TS-native dispatched hooks (`oisin-dev hook foo`)
 * this is the handler name. Both produce the same key so a hook migration
 * (script → dispatcher) replaces the old entry instead of duplicating it.
 *
 * The `.sh` match is intentionally strict so the PATH-prepend segment
 * (`PATH="$PWD/.claude/hooks/bin:$PATH"`) doesn't get misread as a script. */
function extractHookScript(command: string): string | null {
  const dispatchMatch = command.match(/oisin-dev hook ([a-z0-9-]+)/)
  if (dispatchMatch) return `${dispatchMatch[1]}.sh`
  const scriptMatch = command.match(/\.claude\/hooks\/([^\s'"]+\.sh)/)
  return scriptMatch ? scriptMatch[1] : null
}

function pruneRetiredHooks(hooks: Record<string, HookEntry[]>): Record<string, HookEntry[]> {
  const result: Record<string, HookEntry[]> = {}
  for (const [event, entries] of Object.entries(hooks)) {
    const retiredCommands = RETIRED_HOOK_COMMANDS_BY_EVENT[event]
    const filteredEntries = entries
      .map((entry) => ({
        ...entry,
        hooks: entry.hooks.filter((h) => {
          const script = extractHookScript(h.command)
          if (script !== null && RETIRED_HOOK_SCRIPTS.has(script)) return false
          if (retiredCommands && retiredCommands.has(h.command.trim())) return false
          return true
        }),
      }))
      .filter((entry) => entry.hooks.length > 0)
    if (filteredEntries.length > 0) {
      result[event] = filteredEntries
    }
  }
  return result
}

export function mergeClaudeSettings(
  existing: Record<string, unknown>,
  generated: Record<string, unknown>,
): Record<string, unknown> {
  const existingHooks = pruneRetiredHooks(
    ((existing as { hooks?: Record<string, HookEntry[]> }).hooks ?? {}) as Record<
      string,
      HookEntry[]
    >,
  )
  const generatedHooks = (generated as { hooks?: Record<string, HookEntry[]> }).hooks ?? {}
  const mergedHooks: Record<string, HookEntry[]> = { ...existingHooks }
  for (const [event, genEntries] of Object.entries(generatedHooks)) {
    if (!mergedHooks[event]) {
      mergedHooks[event] = genEntries
      continue
    }
    const result: HookEntry[] = [...mergedHooks[event]]
    for (const genEntry of genEntries) {
      const matcher = genEntry.matcher
      const existingIdx = result.findIndex((e) => (e.matcher ?? '') === (matcher ?? ''))
      if (existingIdx === -1) {
        result.push(genEntry)
      } else {
        const updatedHooks = [...result[existingIdx].hooks]
        for (const genHook of genEntry.hooks) {
          const genScript = extractHookScript(genHook.command)
          const existingIdx2 = genScript
            ? updatedHooks.findIndex((h) => extractHookScript(h.command) === genScript)
            : updatedHooks.findIndex((h) => h.command === genHook.command)
          if (existingIdx2 !== -1) {
            updatedHooks[existingIdx2] = genHook
          } else {
            updatedHooks.push(genHook)
          }
        }
        const seen = new Map<string, number>()
        for (let i = 0; i < updatedHooks.length; i++) {
          const key = extractHookScript(updatedHooks[i].command) ?? updatedHooks[i].command
          seen.set(key, i)
        }
        result[existingIdx] = {
          ...result[existingIdx],
          hooks: updatedHooks.filter(
            (_, i) =>
              seen.get(extractHookScript(updatedHooks[i].command) ?? updatedHooks[i].command) === i,
          ),
        }
      }
    }
    mergedHooks[event] = result
  }
  return { ...existing, ...generated, hooks: mergedHooks }
}

function writeOrMergeSettings(
  path: string,
  generated: ReturnType<typeof generateClaudeSettings>,
  log: (msg: string) => void,
): void {
  if (!existsSync(path)) {
    writeJson(path, generated)
    log('.claude/settings.json')
    return
  }

  const existing = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  const existingHooks = pruneRetiredHooks((existing.hooks ?? {}) as Record<string, HookEntry[]>)
  const generatedHooks = generated.hooks as Record<string, HookEntry[]>

  // Merge hook events:
  // - Events only in existing (e.g. PreCompact: bd prime) → keep as-is
  // - Events only in generated → add
  // - Events in both → merge by matcher:
  //     * For a given matcher, generated hooks replace existing hooks for that matcher
  //     * Matchers only in existing are kept (preserves custom hooks like ts-style-guard)
  //     * Commands within a generated matcher that already appear in existing are deduped
  const mergedHooks: Record<string, HookEntry[]> = { ...existingHooks }

  for (const [event, genEntries] of Object.entries(generatedHooks)) {
    if (!mergedHooks[event]) {
      mergedHooks[event] = genEntries
      continue
    }
    const existingEntries = mergedHooks[event]
    const result: HookEntry[] = [...existingEntries]

    for (const genEntry of genEntries) {
      const matcher = genEntry.matcher
      const existingIdx = result.findIndex((e) => (e.matcher ?? '') === (matcher ?? ''))
      if (existingIdx === -1) {
        // New matcher — add it
        result.push(genEntry)
      } else {
        // Merge hooks within this matcher.
        // Generated hooks that reference a .claude/hooks/ script replace any existing
        // hook referencing the same script (handles e.g. adding the cd prefix on update).
        // Other existing hooks (user-custom, like bd prime) are preserved.
        const updatedHooks = [...result[existingIdx].hooks]
        for (const genHook of genEntry.hooks) {
          const genScript = extractHookScript(genHook.command)
          const existingIdx2 = genScript
            ? updatedHooks.findIndex((h) => extractHookScript(h.command) === genScript)
            : updatedHooks.findIndex((h) => h.command === genHook.command)
          if (existingIdx2 !== -1) {
            updatedHooks[existingIdx2] = genHook
          } else {
            updatedHooks.push(genHook)
          }
        }
        // Deduplicate: if the same script appears more than once (e.g. from a
        // previous bad merge), keep the last occurrence for each script.
        const seen = new Map<string, number>()
        for (let i = 0; i < updatedHooks.length; i++) {
          const key = extractHookScript(updatedHooks[i].command) ?? updatedHooks[i].command
          seen.set(key, i)
        }
        result[existingIdx] = {
          ...result[existingIdx],
          hooks: updatedHooks.filter((_, i) => seen.get(extractHookScript(updatedHooks[i].command) ?? updatedHooks[i].command) === i),
        }
      }
    }
    mergedHooks[event] = result
  }

  const merged = { ...existing, ...generated, hooks: mergedHooks }
  writeJson(path, merged)
  log('.claude/settings.json (merged)')
}

const DEV_BLOCK_START = '<!-- BEGIN @oisincoveney/dev managed block -->'
const DEV_BLOCK_END = '<!-- END @oisincoveney/dev managed block -->'

function writeOrMerge(path: string, managed: string, log: (msg: string) => void): void {
  const wrapped = `${DEV_BLOCK_START}\n${managed}\n${DEV_BLOCK_END}\n`
  if (!existsSync(path)) {
    writeFileSync(path, wrapped)
    log(path.split('/').pop() ?? path)
    return
  }
  const existing = readFileSync(path, 'utf8')
  if (existing.includes(DEV_BLOCK_START)) {
    // Replace ALL existing managed blocks (a single canonical block survives).
    // Prior installs sometimes appended instead of replacing, so files in the
    // wild can have 2+ blocks; collapse them on update.
    const re = new RegExp(
      `${escapeRegex(DEV_BLOCK_START)}[\\s\\S]*?${escapeRegex(DEV_BLOCK_END)}\n?`,
      'g',
    )
    let replaced = false
    const updated = existing.replace(re, () => {
      if (replaced) return ''
      replaced = true
      return wrapped
    })
    writeFileSync(path, updated)
    log(`${path.split('/').pop()} (updated managed block)`)
  } else {
    // Prepend managed block, keep existing content
    writeFileSync(path, `${wrapped}\n${existing}`)
    log(`${path.split('/').pop()} (merged, preserved existing)`)
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function mergeManagedBlock(existing: string, managed: string): string {
  const wrapped = `${DEV_BLOCK_START}\n${managed}\n${DEV_BLOCK_END}\n`
  if (existing.includes(DEV_BLOCK_START)) {
    const re = new RegExp(
      `${escapeRegex(DEV_BLOCK_START)}[\\s\\S]*?${escapeRegex(DEV_BLOCK_END)}\n?`,
      'g',
    )
    let replaced = false
    return existing.replace(re, () => {
      if (replaced) return ''
      replaced = true
      return wrapped
    })
  }
  return `${wrapped}\n${existing}`
}

