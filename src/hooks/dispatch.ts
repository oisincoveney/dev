/**
 * Hook dispatcher entry — `oisin-dev hook <name>`.
 *
 * Reads a HookInput JSON from stdin, looks up the handler by name, runs
 * it, and translates the resulting HookDecision into the exit code /
 * stdout shape Claude Code expects:
 *
 *   - { kind: 'allow' }   → exit 0, no output
 *   - { kind: 'block', reason } → reason on stderr, exit 2
 *   - { kind: 'context', event, text } → JSON additionalContext on
 *     stdout, exit 0 (Claude Code injects it into the agent's context)
 *
 * Internal errors fall through to allow() so a buggy handler never
 * deadlocks the harness — the bug surfaces as missing context, not as
 * a blocked tool call.
 */

import { lookupHandler } from './registry.js'
import type { HookDecision } from './types.js'

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function emitDecision(decision: HookDecision): void {
  if (decision.kind === 'allow') {
    process.exit(0)
  }
  if (decision.kind === 'block') {
    process.stderr.write(`${decision.reason}\n`)
    process.exit(2)
  }
  if (decision.kind === 'context') {
    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: decision.event,
          additionalContext: decision.text,
        },
      })}\n`,
    )
    process.exit(0)
  }
}

export async function runHookDispatcher(name: string): Promise<void> {
  const handler = lookupHandler(name)
  if (handler === undefined) {
    process.stderr.write(`oisin-dev hook: unknown handler "${name}"\n`)
    process.exit(0)
    return
  }

  const raw = await readStdin()
  let input: unknown
  try {
    input = raw.length > 0 ? JSON.parse(raw) : {}
  } catch {
    // Malformed stdin → fall through to allow. Hooks should never block
    // because the harness misformatted the payload.
    process.exit(0)
    return
  }

  try {
    const decision = await handler(input as Parameters<typeof handler>[0])
    emitDecision(decision)
  } catch (err) {
    process.stderr.write(
      `oisin-dev hook ${name} crashed: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    // Crash → allow. Don't deadlock the harness on a handler bug.
    process.exit(0)
  }
}
