/**
 * Hook handler registry. Lookup by name (matches the legacy script
 * filename without extension, so `block-coauthor.sh` → `block-coauthor`).
 *
 * Adding a new TS-native handler:
 *   1. Implement under src/hooks/handlers/<name>.ts (export named const).
 *   2. Register here.
 *   3. Wire it from src/orchestrator.ts for the relevant tool overlay.
 *   4. Delete the corresponding shell hook when no overlay still calls it.
 */

import type { HookHandler } from './types.js'
import { blockCoauthor } from './handlers/block-coauthor.js'

export const handlers: Record<string, HookHandler> = {
  'block-coauthor': blockCoauthor,
}

export function lookupHandler(name: string): HookHandler | undefined {
  return handlers[name]
}
