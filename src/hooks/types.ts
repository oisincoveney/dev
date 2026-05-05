/**
 * Shared types for the in-process hook dispatcher.
 *
 * Replaces the bash + jq protocol used by the legacy `.sh` hooks. The
 * dispatcher reads a HookInput from stdin, looks up the handler by name,
 * runs it, and translates the HookDecision into the exit code / JSON
 * stdout shape Claude Code expects.
 */

export type HookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'UserPromptSubmit'
  | 'SessionStart'
  | 'PreCompact'
  | 'Stop'

/** Stdin payload Claude Code passes to every hook. Fields are optional
 * because each event populates a different subset. The handler narrows
 * what it needs. */
export interface HookInput {
  hook_event_name?: HookEvent
  tool_name?: string
  tool_input?: {
    command?: string
    file_path?: string
    filePath?: string
    content?: string
    new_string?: string
    newString?: string
    description?: string
    [k: string]: unknown
  }
  tool_response?: unknown
  cwd?: string
  session_id?: string
  transcript_path?: string
}

/** A handler's return value. The dispatcher translates this into the
 * appropriate exit code + stdout shape Claude Code understands. */
export type HookDecision =
  | { kind: 'allow' }
  | { kind: 'block'; reason: string }
  | { kind: 'context'; event: HookEvent; text: string }

export type HookHandler = (input: HookInput) => HookDecision | Promise<HookDecision>
