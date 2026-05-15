import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import type { DevConfig } from './config.js'

type RunResult =
  | { ok: true }
  | { ok: false; reason: 'exit'; code: number }
  | { ok: false; reason: 'timeout'; afterMs: number }
  | { ok: false; reason: 'signal'; signal: NodeJS.Signals }
  | { ok: false; reason: 'spawn-error'; message: string }
type CaptureRunResult = (RunResult & { ok: false }) | { ok: true; stdout: string; stderr: string }

interface RunOptions {
  cwd: string
  timeoutMs: number
  env?: NodeJS.ProcessEnv
}

interface CaptureRunOptions extends RunOptions {
  input?: string
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
  return normalizeRunResult(result, opts.timeoutMs)
}

function runCommandCapture(
  cmd: string,
  args: ReadonlyArray<string>,
  opts: CaptureRunOptions,
): CaptureRunResult {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    encoding: 'utf8',
    stdio: 'pipe',
    input: opts.input,
    timeout: opts.timeoutMs,
    killSignal: 'SIGKILL',
  })
  const normalized = normalizeRunResult(result, opts.timeoutMs)
  if (!normalized.ok) return normalized
  return { ok: true, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function normalizeRunResult(
  result: ReturnType<typeof spawnSync>,
  timeoutMs: number,
): RunResult {
  if (result.error) {
    const errno = (result.error as NodeJS.ErrnoException).code
    if (errno === 'ETIMEDOUT') return { ok: false, reason: 'timeout', afterMs: timeoutMs }
    return { ok: false, reason: 'spawn-error', message: result.error.message }
  }
  if (result.signal) return { ok: false, reason: 'signal', signal: result.signal }
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

function commandExists(cmd: string): boolean {
  return spawnSync('sh', ['-lc', `command -v ${cmd}`], { stdio: 'ignore' }).status === 0
}

function noGitHooksEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_CONFIG_PARAMETERS: "'core.hooksPath=/dev/null'",
  }
}

export type BeadsCliResult =
  | { status: 'created' }
  | { status: 'exists' }
  | { status: 'no-bd' }
  | { status: 'failed'; error: string }

export function installBeadsCli(cwd: string): BeadsCliResult {
  if (existsSync(join(cwd, '.beads'))) return { status: 'exists' }
  if (!commandExists('bd')) return { status: 'no-bd' }
  const r = runCommand('bd', ['init', '--non-interactive'], {
    cwd,
    timeoutMs: 60_000,
    env: noGitHooksEnv(),
  })
  if (r.ok) return { status: 'created' }
  return { status: 'failed', error: runFailureMessage(r) }
}

export type BeadsConfigureResult = { ok: true } | { ok: false; error: string }

export interface BeadsMigrationReport {
  config: BeadsConfigureResult
  gitignoreUpdated: boolean
  issuesJsonlTracked: boolean
  issuesJsonlUntracked: boolean
  remoteUrl: string | null
}

interface BeadsGitHygieneReport {
  gitignoreUpdated: boolean
  issuesJsonlTracked: boolean
  issuesJsonlUntracked: boolean
}

export function configureBeadsAfterInit(
  cwd: string,
  options: { applyGitHygiene?: boolean } = {},
): BeadsConfigureResult {
  if (!commandExists('bd')) return { ok: false, error: 'bd not in PATH' }
  if (!existsSync(join(cwd, '.beads'))) return { ok: false, error: '.beads/ does not exist' }

  const remoteUrl = getGitOriginUrl(cwd)
  const issuesJsonlBeforeHooks =
    remoteUrl !== null && options.applyGitHygiene !== false ? readBeadsIssuesJsonl(cwd) : null
  if (remoteUrl !== null) {
    const remote = configureBeadsDoltRemote(cwd, remoteUrl)
    if (!remote.ok) return remote
  }

  for (const args of [
    ['--sandbox', 'config', 'set', 'validation.on-create', 'warn'],
    ...(remoteUrl === null
      ? []
      : [
          ['--sandbox', 'config', 'set', 'sync.remote', remoteUrl],
          ['--sandbox', 'config', 'set', 'federation.remote', remoteUrl],
          ['--sandbox', 'config', 'set', 'export.git-add', 'false'],
        ]),
  ]) {
    const result = runCommand('bd', args, { cwd, timeoutMs: 10_000, env: noGitHooksEnv() })
    if (!result.ok) return { ok: false, error: runFailureMessage(result) }
  }

  const hooks = runCommand('bd', ['hooks', 'install'], { cwd, timeoutMs: 30_000 })
  if (!hooks.ok && hooks.reason !== 'exit') return { ok: false, error: runFailureMessage(hooks) }

  for (const file of ['AGENTS.md', 'CLAUDE.md']) {
    const path = join(cwd, file)
    if (existsSync(path)) trimBeadsIntegrationBlock(path)
  }

  if (remoteUrl !== null && options.applyGitHygiene !== false) {
    const hygiene = ensureRepoBackedBeadsGitHygiene(cwd, issuesJsonlBeforeHooks)
    if (!hygiene.ok) return hygiene
  }

  return { ok: true }
}

export function migrateBeadsRepoBackedDolt(cwd: string): BeadsMigrationReport {
  const issuesJsonlBeforeConfigure = readBeadsIssuesJsonl(cwd)
  const config = configureBeadsAfterInit(cwd, { applyGitHygiene: false })
  const hygiene = ensureRepoBackedBeadsGitHygiene(cwd, issuesJsonlBeforeConfigure)

  return {
    config,
    gitignoreUpdated: hygiene.ok ? hygiene.gitignoreUpdated : false,
    issuesJsonlTracked: hygiene.ok ? hygiene.issuesJsonlTracked : false,
    issuesJsonlUntracked: hygiene.ok ? hygiene.issuesJsonlUntracked : false,
    remoteUrl: getGitOriginUrl(cwd),
  }
}

function ensureRepoBackedBeadsGitHygiene(
  cwd: string,
  preservedIssuesJsonl: string | null = readBeadsIssuesJsonl(cwd),
): (BeadsGitHygieneReport & { ok: true }) | { ok: false; error: string } {
  const beforeGitignore = existsSync(join(cwd, '.gitignore'))
    ? readFileSync(join(cwd, '.gitignore'), 'utf8')
    : ''

  appendToGitignore(cwd, '.beads/issues.jsonl')

  const afterGitignore = existsSync(join(cwd, '.gitignore'))
    ? readFileSync(join(cwd, '.gitignore'), 'utf8')
    : ''
  const issuesJsonlTracked = gitPathTracked(cwd, '.beads/issues.jsonl')
  let issuesJsonlUntracked = false

  if (issuesJsonlTracked) {
    const rm = runCommand('git', ['rm', '--cached', '.beads/issues.jsonl'], {
      cwd,
      timeoutMs: 10_000,
      env: noGitHooksEnv(),
    })
    if (!rm.ok) return { ok: false, error: runFailureMessage(rm) }
    issuesJsonlUntracked = true
  }

  if (preservedIssuesJsonl !== null) {
    writeFileSync(join(cwd, '.beads/issues.jsonl'), preservedIssuesJsonl, 'utf8')
  }

  return {
    ok: true,
    gitignoreUpdated: beforeGitignore !== afterGitignore,
    issuesJsonlTracked,
    issuesJsonlUntracked,
  }
}

function readBeadsIssuesJsonl(cwd: string): string | null {
  const path = join(cwd, '.beads/issues.jsonl')
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

function getGitOriginUrl(cwd: string): string | null {
  const r = runCommandCapture('git', ['config', '--get', 'remote.origin.url'], {
    cwd,
    timeoutMs: 5_000,
  })
  if (!r.ok) return null
  const value = r.stdout.trim()
  return value.length > 0 ? value : null
}

function configureBeadsDoltRemote(cwd: string, remoteUrl: string): BeadsConfigureResult {
  const list = runCommandCapture('bd', ['--sandbox', 'dolt', 'remote', 'list'], {
    cwd,
    timeoutMs: 10_000,
  })
  if (!list.ok) return { ok: false, error: runFailureMessage(list) }

  const origin = parseDoltRemoteList(list.stdout).get('origin')
  if (origin !== undefined && sameGitRemote(origin, remoteUrl)) return { ok: true }
  if (origin !== undefined) {
    const remove = runCommand('bd', ['--sandbox', 'dolt', 'remote', 'remove', 'origin'], {
      cwd,
      timeoutMs: 10_000,
      env: noGitHooksEnv(),
    })
    if (!remove.ok) return { ok: false, error: runFailureMessage(remove) }
  }
  const add = runCommand('bd', ['--sandbox', 'dolt', 'remote', 'add', 'origin', remoteUrl], {
    cwd,
    timeoutMs: 10_000,
    env: noGitHooksEnv(),
  })
  if (!add.ok) return { ok: false, error: runFailureMessage(add) }
  return { ok: true }
}

function parseDoltRemoteList(stdout: string): Map<string, string> {
  const remotes = new Map<string, string>()
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const match = trimmed.match(/^(\S+)\s+(\S+)/)
    if (match) remotes.set(match[1], match[2])
  }
  return remotes
}

function sameGitRemote(a: string, b: string): boolean {
  return normalizeGitRemote(a) === normalizeGitRemote(b)
}

function normalizeGitRemote(url: string): string {
  return url
    .replace(/^git\+ssh:\/\//, 'ssh://')
    .replace(/^ssh:\/\/git@([^/]+)\/\.?\//, 'git@$1:')
    .replace(/^git@([^:]+):\.?\//, 'git@$1:')
    .replace(/\/+$/, '')
}

function gitPathTracked(cwd: string, relPath: string): boolean {
  const r = runCommandCapture('git', ['ls-files', '--error-unmatch', relPath], {
    cwd,
    timeoutMs: 5_000,
  })
  return r.ok
}

function appendToGitignore(cwd: string, pattern: string): void {
  const path = join(cwd, '.gitignore')
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : ''
  if (existing.split(/\r?\n/).includes(pattern)) return
  const prefix = existing.length === 0 || existing.endsWith('\n') ? '' : '\n'
  writeFileSync(path, `${existing}${prefix}${pattern}\n`)
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

  const list = runCommandCapture('bd', ['list', '--type=decision', '--status', 'all', '--json'], {
    cwd,
    timeoutMs: 10_000,
  })
  const existingTitles = new Set<string>()
  if (list.ok && list.stdout) {
    try {
      const issues = JSON.parse(list.stdout) as Array<{ title?: string }>
      for (const issue of issues) if (issue.title) existingTitles.add(issue.title)
    } catch {
      // Treat malformed output as empty.
    }
  }

  const decisions = constitutionDecisions(config)
  let created = 0
  for (const decision of decisions) {
    if (existingTitles.has(decision.title)) continue
    const create = runCommandCapture(
      'bd',
      [
        'create',
        '--type=decision',
        '--priority=0',
        `--title=${decision.title}`,
        '--silent',
        '--body-file=-',
      ],
      { cwd, timeoutMs: 10_000, input: decision.body },
    )
    if (!create.ok) return { ok: false, error: `Failed to create decision: ${runFailureMessage(create)}` }
    const id = create.stdout.trim()
    if (id) spawnSync('bd', ['update', id, '--status', 'pinned'], { cwd, timeout: 10_000 })
    created += 1
  }

  if (created > 0) {
    spawnSync('bd', ['config', 'set', 'validation.on-create', 'error'], { cwd, timeout: 10_000 })
  }
  return { ok: true, created }
}

function constitutionDecisions(config: DevConfig): Array<{ title: string; body: string }> {
  return [
    {
      title: `Constitution: package manager is ${config.packageManager}`,
      body: `## Decision\nUse \`${config.packageManager}\` for dependency management commands.\n\n## Rationale\nCaptured by @oisincoveney/dev init answers and rendered to mise tasks.`,
    },
    {
      title: `Constitution: test command is ${config.commands.test ?? 'unset'}`,
      body: `## Decision\nThe canonical test command is \`${config.commands.test ?? 'unset'}\`.\n\n## Rationale\nExplicit single-source command keeps proof-of-work checks deterministic.`,
    },
    {
      title: 'Constitution: destructive ops require explicit user approval',
      body: '## Decision\nNever run destructive commands without explicit user approval. The destructive-command-guard hook enforces this.',
    },
    {
      title: 'Constitution: no follow-up questions in agent output',
      body: '## Decision\nAgent responses must not end with follow-up prompts. This is a prompt-level style rule.',
    },
    {
      title: 'Constitution: no completion claims without proof',
      body: '## Decision\nNever claim completion without having executed the configured test command this session. Pre-stop-verification hook enforces this.',
    },
  ]
}

export function trimBeadsIntegrationBlock(path: string): void {
  if (!existsSync(path)) return
  const content = readFileSync(path, 'utf8')
  const start = content.indexOf('<!-- BEGIN BEADS INTEGRATION')
  if (start === -1) return
  const endMarker = '<!-- END BEADS INTEGRATION -->'
  const end = content.indexOf(endMarker, start)
  if (end === -1) return
  const blockEnd = end + endMarker.length
  const before = content.slice(0, start)
  const block = content.slice(start, blockEnd)
  const after = content.slice(blockEnd)
  const sessionCompletion = block.indexOf('\n## Session Completion')
  if (sessionCompletion === -1) return
  const trimmedBlock = `${block.slice(0, sessionCompletion).trimEnd()}\n${endMarker}`
  writeFileSync(path, `${before}${trimmedBlock}${after}`)
}

export type BeadsPluginResult =
  | { status: 'installed' }
  | { status: 'already-installed' }
  | { status: 'no-claude' }
  | { status: 'failed'; error: string }

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
  const install = runCommand(
    'claude',
    ['plugin', 'install', '--scope', 'project', 'beads'],
    { cwd, timeoutMs: 60_000 },
  )
  if (install.ok) return { status: 'installed' }
  if (install.reason === 'exit') return { status: 'already-installed' }
  return { status: 'failed', error: runFailureMessage(install) }
}

export function pruneScopeGuardHook(
  settingsPath: string,
  log: (msg: string) => void,
  warn: (msg: string) => void,
): boolean {
  if (!existsSync(settingsPath)) return false
  let settings: Record<string, unknown>
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>
  } catch (e) {
    warn(`scope-guard prune: ${settingsPath} is not valid JSON: ${(e as Error).message}`)
    return false
  }
  const removed = pruneHookCommands(settings, (command) => command.includes('scope-guard'))
  if (removed > 0) {
    mkdirSync(dirname(settingsPath), { recursive: true })
    writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
    log('removed scope-guard from ~/.claude/settings.json')
    return true
  }
  return false
}

export function pruneGroundedCodexHooks(
  hooksPath: string,
  log: (msg: string) => void,
  warn: (msg: string) => void,
): boolean {
  if (!existsSync(hooksPath)) return false
  let config: Record<string, unknown>
  try {
    config = JSON.parse(readFileSync(hooksPath, 'utf8')) as Record<string, unknown>
  } catch (e) {
    warn(`codex grounded prune: ${hooksPath} is not valid JSON: ${(e as Error).message}`)
    return false
  }
  const removed = pruneHookCommands(config, (command) => command.includes('@pinperepette/grounded'))
  if (removed > 0) {
    writeFileSync(hooksPath, `${JSON.stringify(config, null, 2)}\n`)
    log(`removed ${removed} grounded hook(s) from ~/.codex/hooks.json`)
    return true
  }
  return false
}

function pruneHookCommands(obj: unknown, shouldRemove: (command: string) => boolean): number {
  if (Array.isArray(obj)) {
    let removed = 0
    for (let i = obj.length - 1; i >= 0; i -= 1) {
      const item = obj[i]
      if (
        item &&
        typeof item === 'object' &&
        'command' in item &&
        typeof (item as { command?: unknown }).command === 'string' &&
        shouldRemove((item as { command: string }).command)
      ) {
        obj.splice(i, 1)
        removed += 1
      } else {
        const hadHooksArray = Boolean(
          item &&
          typeof item === 'object' &&
          'hooks' in item &&
          Array.isArray((item as { hooks?: unknown }).hooks),
        )
        const nestedRemoved = pruneHookCommands(item, shouldRemove)
        removed += nestedRemoved
        if (
          nestedRemoved > 0 &&
          hadHooksArray &&
          item &&
          typeof item === 'object' &&
          (!('hooks' in item) ||
            (Array.isArray((item as { hooks?: unknown }).hooks) &&
              (item as { hooks: unknown[] }).hooks.length === 0))
        ) {
          obj.splice(i, 1)
        }
      }
    }
    return removed
  }
  if (obj && typeof obj === 'object') {
    let removed = 0
    for (const [key, value] of Object.entries(obj)) {
      const nestedRemoved = pruneHookCommands(value, shouldRemove)
      removed += nestedRemoved
      if (nestedRemoved > 0 && Array.isArray(value) && value.length === 0) {
        delete (obj as Record<string, unknown>)[key]
      }
    }
    return removed
  }
  return 0
}
