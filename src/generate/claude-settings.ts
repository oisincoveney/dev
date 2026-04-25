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
function hook(script: string, timeout?: number): HookCommand {
  return {
    type: 'command',
    command: `cd "$(git rev-parse --show-toplevel)" && .claude/hooks/${script}`,
    ...(timeout !== undefined ? { timeout } : {}),
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

  const settings: ClaudeSettings = {
    hooks: {
      SessionStart: [
        {
          hooks: [hook('context-bootstrap.sh', 10)],
        },
      ],
      UserPromptSubmit: [
        {
          hooks: [hook('context-injector.sh', 5)],
        },
      ],
      PreToolUse: [
        {
          matcher: 'Write|Edit',
          hooks: [
            ...(config.language === 'typescript'
              ? [hook('ts-style-guard.sh', 30), hook('import-validator.sh', 10)]
              : []),
            hook('ai-antipattern-guard.sh', 10),
          ],
        },
        {
          matcher: 'Bash',
          hooks: [
            hook('destructive-command-guard.sh', 5),
            hook('block-coauthor.sh', 5),
          ],
        },
        {
          matcher: 'TodoWrite',
          hooks: [hook('block-todowrite.sh', 5)],
        },
      ],
      PostToolUse: [
        {
          matcher: 'Write|Edit',
          hooks: [hook('post-edit-check.sh', 60)],
        },
      ],
      Stop: [
        {
          hooks: [
            hook('pre-stop-verification.sh', 30),
            hook('banned-words-guard.sh', 10),
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

  return settings
}
