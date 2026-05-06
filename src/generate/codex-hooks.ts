/**
 * Generates .codex/hooks.json.
 *
 * Codex hook output is surfaced more aggressively than Claude's, and its hook
 * event/matcher behavior is not a 1:1 match for Claude Code. Keep this set
 * intentionally tiny: only hard Bash safety hooks that are silent on allow
 * paths. Project context, Stop verification, and post-edit checks stay in
 * Claude/OpenCode where their runtimes handle those hooks cleanly.
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

interface CodexHooks {
  hooks: {
    PreToolUse: Hook[]
  }
}

function hook(script: string, timeout?: number): HookCommand {
  return {
    type: 'command',
    command: `cd "$(git rev-parse --show-toplevel)" && PATH="$PWD/.codex/hooks/bin:$PATH" .codex/hooks/${script}`,
    ...(timeout !== undefined ? { timeout } : {}),
  }
}

export function generateCodexHooks(_config: DevConfig): CodexHooks {
  const hooks: CodexHooks['hooks'] = {
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [hook('destructive-command-guard.sh', 5)],
      },
    ],
  }

  return { hooks }
}
