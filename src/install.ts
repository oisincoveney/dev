import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { DevConfig } from './config.js'

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
  return normalizeRunResult(result, opts.timeoutMs)
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

function noGitHooksEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_CONFIG_PARAMETERS: "'core.hooksPath=/dev/null'",
  }
}

export type BacklogCliResult =
  | { status: 'created' }
  | { status: 'exists' }
  | { status: 'no-backlog' }
  | { status: 'failed'; error: string }

export function installBacklogCli(cwd: string): BacklogCliResult {
  if (
    existsSync(join(cwd, 'backlog')) ||
    existsSync(join(cwd, '.backlog')) ||
    existsSync(join(cwd, 'backlog.config.yml'))
  ) {
    return { status: 'exists' }
  }

  const backlogArgs = [
    'init',
    basename(cwd),
    '--defaults',
    '--agent-instructions',
    'none',
    '--integration-mode',
    'cli',
    '--backlog-dir',
    'backlog',
    '--config-location',
    'root',
    '--no-git',
  ]
  if (existsSync(join(cwd, 'mise.toml'))) {
    const result = runCommand('mise', ['exec', '--', 'backlog', ...backlogArgs], {
      cwd,
      timeoutMs: 60_000,
      env: noGitHooksEnv(),
    })
    if (result.ok) return { status: 'created' }
  }

  const fallback = runCommand('backlog', backlogArgs, { cwd, timeoutMs: 60_000, env: noGitHooksEnv() })
  if (fallback.ok) return { status: 'created' }
  if (fallback.reason === 'spawn-error') {
    const bunx = runCommand('bunx', ['--package', 'backlog.md', 'backlog', ...backlogArgs], {
      cwd,
      timeoutMs: 60_000,
      env: noGitHooksEnv(),
    })
    if (bunx.ok) return { status: 'created' }
    if (bunx.reason === 'spawn-error') return { status: 'no-backlog' }
    return { status: 'failed', error: runFailureMessage(bunx) }
  }
  return { status: 'failed', error: runFailureMessage(fallback) }
}

export type SeedConstitutionResult =
  | { ok: true; created: number }
  | { ok: false; error: string }

export function seedBacklogConstitutionDecisions(
  _cwd: string,
  _config: DevConfig,
): SeedConstitutionResult {
  return { ok: true, created: 0 }
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
