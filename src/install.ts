/**
 * Installs hooks, configs, skills, and instruction files into the target directory.
 * Reads from templates/ and writes to the project, and runs side-effect installs
 * (bd init, beads plugin, MCP servers, GSD/IDD toolkits).
 */

import { execSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as p from '@clack/prompts'
import type { DevConfig } from './config.js'
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
}

export async function installAll(
  cwd: string,
  config: DevConfig,
  answers: Answers,
  options: InstallOptions = {},
): Promise<void> {
  const log = (msg: string): void => {
    // biome-ignore lint: CLI output
    console.log(`  ✓ ${msg}`)
  }
  const warn = (msg: string): void => {
    // biome-ignore lint: CLI output
    console.log(`  ⚠ ${msg}`)
  }

  // ─── File generation ────────────────────────────────────────────────

  if (config.targets.includes('claude')) {
    installClaudeHooks(cwd, log)
    const settings = generateClaudeSettings(config)
    if (options.isUpdate) {
      writeOrMergeSettings(join(cwd, '.claude', 'settings.json'), settings, log)
    } else {
      writeJson(join(cwd, '.claude', 'settings.json'), settings)
      log('.claude/settings.json')
    }
    installOwnedSkills(cwd, log)
    installProjectSkills(cwd, config, log, warn)
  }

  if (config.targets.includes('codex')) {
    installCodexHooks(cwd, log)
    const hooks = generateCodexHooks(config)
    writeJson(join(cwd, '.codex', 'hooks.json'), hooks)
    log('.codex/hooks.json')
  }

  if (config.targets.includes('opencode')) {
    const plugin = generateOpencodePlugin(config)
    const pluginDir = join(cwd, '.opencode', 'plugins')
    mkdirSync(pluginDir, { recursive: true })
    writeFileSync(join(pluginDir, 'dev-enforcer.ts'), plugin)
    log('.opencode/plugins/dev-enforcer.ts')
  }

  if (config.targets.includes('cursor')) {
    const rules = generateCursorRules(config, TEMPLATES_DIR)
    const rulesDir = join(cwd, '.cursor', 'rules')
    mkdirSync(rulesDir, { recursive: true })
    for (const rule of rules) {
      writeFileSync(join(rulesDir, rule.filename), rule.content)
      log(`.cursor/rules/${rule.filename}`)
    }
  }

  if (config.targets.includes('lefthook')) {
    if (options.isUpdate) {
      warn('lefthook.yml — skipped on update (merge manually if needed)')
    } else {
      const lefthook = generateLefthook(config)
      writeFileSync(join(cwd, 'lefthook.yml'), lefthook)
      log('lefthook.yml')
    }
  }

  if (!options.isUpdate) {
    // Language-specific lint/format configs. Warn before overwriting existing.
    const lintConfigs = generateLintConfig(config)
    for (const [filename, contents] of Object.entries(lintConfigs)) {
      const dest = join(cwd, filename)
      if (existsSync(dest)) {
        const backup = `${dest}.dev-backup`
        copyFileSync(dest, backup)
        warn(`${filename} already exists — backed up to ${filename}.dev-backup`)
      }
      writeFileSync(dest, contents)
      log(filename)
    }

    // Tool configs (Semgrep, commitlint, Stryker/cargo-mutants/go-mutesting,
    // dependency-cruiser, strict tsconfig)
    const toolConfigs = generateToolConfigs(config)
    for (const [filename, contents] of Object.entries(toolConfigs)) {
      const dest = join(cwd, filename)
      if (existsSync(dest)) {
        const backup = `${dest}.dev-backup`
        copyFileSync(dest, backup)
        warn(`${filename} already exists — backed up to ${filename}.dev-backup`)
      }
      writeFileSync(dest, contents)
      log(filename)
    }
  }

  // CLAUDE.md and AGENTS.md — small kernel; the detail lives in .claude/rules/.
  const bundle = buildClaudeMdBundle(config, answers)
  writeOrMerge(join(cwd, 'CLAUDE.md'), bundle.root, log)
  writeOrMerge(join(cwd, 'AGENTS.md'), bundle.root, log)

  // .claude/rules/ — the primary Claude Code context channel.
  if (config.targets.includes('claude')) {
    const rulesDir = join(cwd, '.claude', 'rules')
    mkdirSync(rulesDir, { recursive: true })
    const rules = generateRules(config, TEMPLATES_DIR)
    for (const rule of rules) {
      writeFileSync(join(rulesDir, rule.filename), rule.content)
      log(`.claude/rules/${rule.filename}`)
    }

    // .claude/commands/ — single-purpose slash commands.
    const commandsDir = join(cwd, '.claude', 'commands')
    mkdirSync(commandsDir, { recursive: true })
    for (const cmd of generateCommands(config)) {
      writeFileSync(join(commandsDir, cmd.filename), cmd.content)
      log(`.claude/commands/${cmd.filename}`)
    }
  }

  // Specs directory
  const specsDir = join(cwd, '.claude', 'specs')
  mkdirSync(specsDir, { recursive: true })
  writeFileSync(join(specsDir, 'TEMPLATE.md'), specTemplate())
  log('.claude/specs/TEMPLATE.md')

  // ─── Side-effect installs ───────────────────────────────────────────

  if (options.skipSideEffects) return

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

  if (config.workflow === 'gsd') {
    installGsd(cwd, log, warn)
  } else if (config.workflow === 'idd') {
    installIdd(cwd, log, warn)
  }
}

function installClaudeHooks(cwd: string, log: (msg: string) => void): void {
  const srcDir = join(TEMPLATES_DIR, 'hooks')
  const destDir = join(cwd, '.claude', 'hooks')
  mkdirSync(destDir, { recursive: true })
  for (const file of readdirSync(srcDir)) {
    const src = join(srcDir, file)
    const dest = join(destDir, file)
    copyFileSync(src, dest)
    chmodSync(dest, 0o755)
    log(`.claude/hooks/${file}`)
  }
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
function installOwnedSkills(cwd: string, log: (msg: string) => void): void {
  const srcDir = join(TEMPLATES_DIR, 'skills')
  if (!existsSync(srcDir)) return
  const destRoot = join(cwd, '.claude', 'skills')
  mkdirSync(destRoot, { recursive: true })
  for (const entry of readdirSync(srcDir)) {
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
  try {
    execSync('bd init --non-interactive', {
      cwd,
      stdio: 'pipe',
      env: {
        ...process.env,
        GIT_CONFIG_PARAMETERS: "'core.hooksPath=/dev/null'",
      },
    })
    return { status: 'created' }
  } catch (err) {
    return { status: 'failed', error: (err as Error).message }
  }
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
  try {
    execSync('claude plugin marketplace add --scope project steveyegge/beads', {
      cwd,
      stdio: 'pipe',
      timeout: 30_000,
    })
    execSync('claude plugin install --scope project beads', {
      cwd,
      stdio: 'pipe',
      timeout: 30_000,
    })
    return { status: 'installed' }
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('already') || msg.includes('exists')) {
      return { status: 'already-installed' }
    }
    return { status: 'failed', error: msg }
  }
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

function installGsd(
  cwd: string,
  log: (msg: string) => void,
  warn: (msg: string) => void,
): void {
  // GSD is installed as a Claude Code plugin from the marketplace.
  if (!commandExists('claude')) {
    warn('GSD: `claude` CLI not in PATH. Install GSD manually from https://gsd.build')
    return
  }
  try {
    execSync('claude plugin marketplace add --scope project gsd-build/get-shit-done', {
      cwd,
      stdio: 'pipe',
    })
    execSync('claude plugin install --scope project get-shit-done', { cwd, stdio: 'pipe' })
    log('GSD plugin installed')
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('already')) {
      log('GSD plugin already installed')
    } else {
      warn(`GSD install failed (${msg}). Install manually: https://gsd.build`)
    }
  }
}

function installIdd(
  cwd: string,
  log: (msg: string) => void,
  warn: (msg: string) => void,
): void {
  // IDD Complete Toolkit is a set of skills + templates cloned from GitHub.
  const iddDir = join(cwd, '.claude', 'idd')
  if (existsSync(iddDir)) {
    log('IDD: .claude/idd already exists, skipping')
    return
  }
  if (!commandExists('git')) {
    warn('IDD: `git` not in PATH, skipping IDD toolkit install')
    return
  }
  try {
    execSync(`git clone --depth 1 https://github.com/ArcBlock/idd.git ${iddDir}`, {
      cwd,
      stdio: 'pipe',
    })
    log('IDD: toolkit cloned to .claude/idd/')
  } catch (err) {
    warn(`IDD clone failed (${(err as Error).message}). Manual install: https://intent-driven.dev`)
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

/** Extracts the .claude/hooks/foo.sh filename from a hook command, regardless of prefix. */
function extractHookScript(command: string): string | null {
  const match = command.match(/\.claude\/hooks\/([^\s'"]+)/)
  return match ? match[1] : null
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
  const existingHooks = (existing.hooks ?? {}) as Record<string, HookEntry[]>
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
    // Replace existing managed block
    const re = new RegExp(
      `${escapeRegex(DEV_BLOCK_START)}[\\s\\S]*?${escapeRegex(DEV_BLOCK_END)}\n?`,
    )
    const updated = existing.replace(re, wrapped)
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

function specTemplate(): string {
  return `# Spec: <Title>

## Overview
<Problem being solved, target users, context>

## Success Criteria
- [ ] <Test case 1: expected behavior>
- [ ] <Test case 2: edge case>
- [ ] <Test case 3: error case>

## Implementation Plan
### Step 1: <Module/File>
- [ ] <Change A>
- [ ] <Change B>

### Step 2: <Module/File>
- [ ] <Change A>

## Constraints & Non-Goals
<What's out of scope, why>

## Rollback Plan
<How to revert if something breaks>
`
}
