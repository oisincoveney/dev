---
name: human-flag-discipline
description: When workers break IN_FLIGHT to ping user vs append a Backlog blocker note and continue. Goal: keep user out-of-loop during fan-out except for true blockers.
---

# Human Flag Discipline

User stays out of swarm IN_FLIGHT. Workers don't ping mid-flight except for tracer-fail or destructive-op-needed. Everything else → append a Backlog blocker note, continue, surface in next Stop digest.

## Rules

### Worker breaks IN_FLIGHT (chat ping) ONLY when:

1. **Tracer child verifier-FAIL.** Tracer fail invalidates DAG — siblings depending on tracer can't proceed. User must decide: re-attempt, redesign, abort.
2. **Destructive op needed** (already gated by `destructive-command-guard.sh`). Schema migration, data deletion, force-push: requires explicit user OK.

That's it. Two cases.

### Worker appends a Backlog blocker note + continues when:

- Non-tracer child verifier-FAIL.
- Non-tracer child PARTIAL.
- Ambiguous EARS criterion needs clarification.
- Missing dependency / out-of-scope discovery.
- Test fixture missing or generation needed.
- Worker's own task hits a blocker (e.g., env var unset).

Worker note:
```bash
backlog task edit <id> --append-notes "HUMAN: <short>. <long, with file:line + verifier output>"
```

Worker reports `<id>: PARTIAL — <reason>` in fan-out summary, lets siblings finish.

### Sibling isolation

Worker FAIL/PARTIAL never auto-aborts siblings. Each worker independent worktree, independent ticket. Fan-out summary aggregates at end:
```
Fan-out summary (N tickets):
  ✓ <id>: PASS — <subject>
  ✓ <id>: PASS-WITH-FOLLOWUPS (filed M discovered-from)
  ⚑ <id>: PARTIAL — human decision needed
  ✗ <id>: FAIL — <reason>
```

## Stop Summary Surfaces Flags

Verifier and finish summaries include one block per active graph:
```
SWARM DIGEST — <epic-id> · <title>
  N closed  ·  M in_progress  ·  K blocked  ·  total T
  D discovered-from filed
  ⚑ H human-flagged — review the linked Backlog task notes
```

User sees flags in tracker notes and final summaries, not mid-flight. Resolve by appending a Backlog task note and updating task status.

## Forbidden

- DON'T page user mid-flight for non-tracer failures.
- DON'T silently absorb scope (use `discovered-from` ticket).
- DON'T close a human-flagged task without user response/dismiss.
- DON'T let tracer-fail proceed silently — it invalidates the swarm.

## See also

- `tracker-workflow.md` — orchestrator, worktree agent, graph, and verifier policy
- `spec-verifier/SKILL.md` — tracker-backed verifier output shape
- `scope-discipline.md` — discovered-from ticket flow
