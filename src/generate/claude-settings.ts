/**
 * Generates .claude/settings.json — hooks + permissions + mcpServers.
 */

import type { DevConfig } from '../config.js'

interface HookCommand {
  type: 'command'
  command: string
  timeout?: number
}

interface Hook {
  matcher?: string
  hooks: HookCommand[]
}

interface ClaudeSettings {
  hooks: {
    UserPromptSubmit?: Hook[]
    PreToolUse?: Hook[]
    PostToolUse?: Hook[]
    SessionStart?: Hook[]
    Stop?: Hook[]
    PreCompact?: Hook[]
  }
  permissions: {
    mode: string
    rules: Array<{
      tool: string
      decision: 'deny' | 'allow' | 'ask'
      if?: string
      reason: string
    }>
  }
  statusLine?: {
    type: 'command'
    command: string
  }
  mcpServers?: Record<string, unknown>
}

// Hook commands use relative paths (.claude/hooks/foo.sh), but Claude Code may
// run them from a subdirectory (common in monorepos). Prefix every command with
// a cd to the git root so the path resolves correctly regardless of cwd.
//
// Also PATH-prepend .claude/hooks/bin/ so the per-repo `bd` shim wins over any
// global install. Hooks (and any subprocess they spawn) get the same bd binary
// the rest of the harness uses, regardless of how the user installed beads.

function hook(script: string, timeout?: number): HookCommand {
  return hookGroup([script], timeout)
}

function hookGroup(scripts: string[], timeout?: number): HookCommand {
  const args = scripts.map((script) => `.claude/hooks/${script}`).join(' ')
  return {
    type: 'command',
    command: `cd "$(git rev-parse --show-toplevel)" && PATH="$PWD/.claude/hooks/bin:$PATH" .claude/hooks/run-quiet.sh ${args}`,
    ...(timeout !== undefined ? { timeout } : {}),
  }
}

function preToolDispatchHook(beadsEnabled: boolean, hasTypescript: boolean): HookCommand {
  const env = [
    beadsEnabled ? 'OISIN_DEV_BEADS=1' : '',
    hasTypescript ? 'OISIN_DEV_TYPESCRIPT=1' : '',
  ].filter(Boolean).join(' ')
  const prefix = env.length > 0 ? `${env} ` : ''
  return {
    type: 'command',
    command: `cd "$(git rev-parse --show-toplevel)" && PATH="$PWD/.claude/hooks/bin:$PATH" ${prefix}.claude/hooks/pre-tool-dispatch.sh`,
    timeout: 30,
  }
}

export function generateClaudeSettings(config: DevConfig): ClaudeSettings {
  const verificationCommands = [
    config.commands.typecheck,
    config.commands.lint,
    config.commands.test,
  ].filter((cmd): cmd is string => typeof cmd === 'string' && cmd.length > 0)

  const verificationAllowPattern = [
    ...verificationCommands,
    'git status',
    'git diff',
    'git log',
    'bd *',
  ].join('|')

  const beadsEnabled = config.tools.includes('beads')
  const languages = config.languages ?? [config.language]
  const hasTypescript = languages.includes('typescript')

  const settings: ClaudeSettings = {
    hooks: {
      SessionStart: [
        {
          hooks: [hookGroup(['context-bootstrap.sh', 'baseline-pin.sh'], 120)],
        },
      ],
      UserPromptSubmit: [
        {
          hooks: [
            beadsEnabled ? hook('bd-context-inject.sh', 5) : hook('context-injector.sh', 5),
          ],
        },
      ],
      PreToolUse: [
        {
          hooks: [preToolDispatchHook(beadsEnabled, hasTypescript)],
        },
      ],
      PostToolUse: [
        {
          matcher: 'Write|Edit',
          hooks: [hookGroup(['post-edit-check.sh', 'ai-antipattern-guard.sh'], 60)],
        },
      ],
      Stop: [
        {
          hooks: [
            hookGroup(
              [
                'worktree-stop-guard.sh',
                ...(beadsEnabled ? ['swarm-digest.sh'] : []),
                'pre-stop-verification.sh',
                'verifier-skill-guard.sh',
                'baseline-compare.sh',
                'citation-check.sh',
                'ai-antipattern-guard.sh',
                'banned-words-guard.sh',
              ],
              120,
            ),
          ],
        },
      ],
      PreCompact: [
        {
          hooks: [hook('pre-compact-prime.sh', 10)],
        },
      ],
    },
    statusLine: {
      type: 'command',
      command: `cd "$(git rev-parse --show-toplevel)" && .claude/hooks/statusline.sh`,
    },
    permissions: {
      mode: 'default',
      rules: [
        {
          tool: 'Bash',
          decision: 'deny',
          if: 'Bash(rm -rf|git reset --hard|git push --force|git push -f )',
          reason: 'Destructive commands require explicit user approval',
        },
        {
          tool: 'Read',
          decision: 'allow',
          reason: 'Read-only file access',
        },
        {
          tool: 'Glob',
          decision: 'allow',
          reason: 'Read-only search',
        },
        {
          tool: 'Grep',
          decision: 'allow',
          reason: 'Read-only search',
        },
        {
          tool: 'Bash',
          decision: 'allow',
          if: `Bash(${verificationAllowPattern})`,
          reason: 'Safe verification and task tracking',
        },
        {
          tool: 'Bash',
          decision: 'ask',
          if: 'Bash(git commit*|git push*)',
          reason: 'Git operations require review',
        },
        {
          tool: 'Edit',
          decision: 'ask',
          reason: 'Code changes require approval',
        },
        {
          tool: 'Write',
          decision: 'ask',
          reason: 'File creation requires approval',
        },
      ],
    },
  }

  if (beadsEnabled) {
    settings.mcpServers = {
      ...(settings.mcpServers ?? {}),
      context7: {
        command: 'npx',
        args: ['-y', '@upstash/context7-mcp@latest'],
      },
    }
  }

  return settings
}
