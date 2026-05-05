/**
 * Hook handler registry. Lookup by name (matches the legacy script
 * filename without extension, so `block-coauthor.sh` → `block-coauthor`).
 *
 * Adding a new TS-native handler:
 *   1. Implement under src/hooks/handlers/<name>.ts (export named const).
 *   2. Register here.
 *   3. Add the script base name to MIGRATED_HOOKS in
 *      src/generate/claude-settings.ts so the install step emits the new
 *      `oisin-dev hook <name>` invocation instead of the legacy `.sh`
 *      shell-out.
 *   4. Delete the corresponding templates/hooks/<name>.sh.
 */

import type { HookHandler } from './types.js'
import { blockCoauthor } from './handlers/block-coauthor.js'

export const handlers: Record<string, HookHandler> = {
  'block-coauthor': blockCoauthor,
}

export function lookupHandler(name: string): HookHandler | undefined {
  return handlers[name]
}
