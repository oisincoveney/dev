/**
 * Hook handler registry. Lookup by name (matches the legacy script
 * filename without extension, so `block-coauthor.sh` → `block-coauthor`).
 */

import type { HookHandler } from './types.js'
import { aiAntipatternGuard } from './handlers/ai-antipattern-guard.js'
import { auditLog } from './handlers/audit-log.js'
import { bannedWordsGuard } from './handlers/banned-words-guard.js'
import { baselineCompare } from './handlers/baseline-compare.js'
import { baselinePin } from './handlers/baseline-pin.js'
import { bdContextInject } from './handlers/bd-context-inject.js'
import { bdCreateGate } from './handlers/bd-create-gate.js'
import { bdRememberProtect } from './handlers/bd-remember-protect.js'
import { blockCoauthor } from './handlers/block-coauthor.js'
import { blockTodowrite } from './handlers/block-todowrite.js'
import { citationCheck } from './handlers/citation-check.js'
import { contextBootstrap } from './handlers/context-bootstrap.js'
import { contextInjector } from './handlers/context-injector.js'
import { destructiveCommandGuard } from './handlers/destructive-command-guard.js'
import { docsFirst } from './handlers/docs-first.js'
import { importValidator } from './handlers/import-validator.js'
import { planApprovalGuard } from './handlers/plan-approval-guard.js'
import { postEditCheck } from './handlers/post-edit-check.js'
import { preCompactPrime } from './handlers/pre-compact-prime.js'
import { preStopVerification } from './handlers/pre-stop-verification.js'
import { requireClaim } from './handlers/require-claim.js'
import { requireSwarm } from './handlers/require-swarm.js'
import { swarmDigest } from './handlers/swarm-digest.js'
import { tsStyleGuard } from './handlers/ts-style-guard.js'
import { verifierSkillGuard } from './handlers/verifier-skill-guard.js'
import { worktreeStopGuard } from './handlers/worktree-stop-guard.js'
import { worktreeWriteGuard } from './handlers/worktree-write-guard.js'

export const handlers: Record<string, HookHandler> = {
  'ai-antipattern-guard': aiAntipatternGuard,
  'audit-log': auditLog,
  'banned-words-guard': bannedWordsGuard,
  'baseline-compare': baselineCompare,
  'baseline-pin': baselinePin,
  'bd-context-inject': bdContextInject,
  'bd-create-gate': bdCreateGate,
  'bd-remember-protect': bdRememberProtect,
  'block-coauthor': blockCoauthor,
  'block-todowrite': blockTodowrite,
  'citation-check': citationCheck,
  'context-bootstrap': contextBootstrap,
  'context-injector': contextInjector,
  'destructive-command-guard': destructiveCommandGuard,
  'docs-first': docsFirst,
  'import-validator': importValidator,
  'plan-approval-guard': planApprovalGuard,
  'post-edit-check': postEditCheck,
  'pre-compact-prime': preCompactPrime,
  'pre-stop-verification': preStopVerification,
  'require-claim': requireClaim,
  'require-swarm': requireSwarm,
  'swarm-digest': swarmDigest,
  'ts-style-guard': tsStyleGuard,
  'verifier-skill-guard': verifierSkillGuard,
  'worktree-stop-guard': worktreeStopGuard,
  'worktree-write-guard': worktreeWriteGuard,
}

export function lookupHandler(name: string): HookHandler | undefined {
  return handlers[name]
}
