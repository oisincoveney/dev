---
name: parallel-tickets
description: Orchestrate parallel sub-agents in isolated git worktrees, one per ready-front ticket in an active swarm. Use only when the user explicitly opts in (menu choice "fan out") AND the swarm has ≥2 ready fronts. Capped at 3 concurrent.
---

# Parallel Tickets (worktree fan-out)

This skill orchestrates **parallel sub-agents**, each scoped to a single bd ticket, each in its own git worktree. Use only when:

1. The user explicitly opted in via a planning-menu choice ("fan out").
2. The active swarm has **≥2 ready fronts** (per `bd swarm validate <epic-id>`).
3. The tickets are AFK-safe (no shared state, no port conflicts, no cross-ticket coordination).

If any of those is false, do serial work instead.

## Cap: 3 concurrent

Hard cap at 3 parallel sub-agents. Token cost is ~15× of serial per [research](https://github.com/spillwavesolutions/parallel-worktrees), and IDE / file watcher / dependency-install overhead spikes past 3.

## Orchestration steps

### 1. Confirm the swarm is registered

```bash
bd swarm validate <epic-id>
```

If validation fails (cycles, orphans), halt and surface to user. Don't fan out an invalid graph.

### 2. Pick the ready fronts

```bash
bd ready --json --mol <epic-id>
```

Take up to 3 ticket IDs. Each must be unblocked AND not in_progress AND not already claimed by another worker.

### 3. Spawn one sub-agent per ticket

For each ticket ID, spawn an `Agent` with:

- `subagent_type: "general-purpose"`
- `isolation: "worktree"` (creates `.claude/worktrees/<auto-name>/` branched from `origin/HEAD`)
- A **self-contained prompt** (the sub-agent must function without orchestrator context)

The sub-agent prompt MUST include, verbatim:

```
You are a single-ticket worker. Re-read everything from bd; do not trust any
context you receive from the caller.

Steps:
1. bd update <id> --claim    (claim the ticket; idempotent)
2. bd show <id>              (read the body; identify EARS criteria + Files Likely Touched + Verification Commands)
3. Implement the change end-to-end. TDD per project rules: failing test first.
4. Run every command listed under ## Verification Commands. They must all exit 0.
5. Spawn the spec-verifier skill via Skill({ skill: "spec-verifier", args: "<id>" }).
6. Branch on verifier result:
   - PASS or PASS-WITH-FOLLOWUPS: bd close <id> --reason "verified by spec-verifier".
   - PARTIAL or FAIL: report failure summary; do NOT close; do NOT commit.
7. If close succeeded, commit with `feat(<id>): <one-line subject>` (or fix:/refactor:/etc.) — lefthook commit-msg enforces this format.
8. Push the worktree's ticket branch (`git push -u origin HEAD`). The branch is the sandbox; pushing it is part of completing the ticket.
9. Return a one-line status to the caller: "<id>: PASS | FAIL | PARTIAL — <message>".

Forbidden:
- Editing files outside Files Likely Touched (file a discovered-from ticket instead).
- Closing the ticket without a verifier PASS or PASS-WITH-FOLLOWUPS.
- `git push --force` / `--force-with-lease` without the user explicitly authorizing it for this branch.
- Pushing to `main` / `master` directly. The worker only pushes its own ticket branch.
- Merging or opening a PR. Merging is the user's call.
```

### 4. Failure isolation

When any sub-agent returns FAIL or PARTIAL: capture the message, do NOT auto-abort siblings. Siblings finish independently. Report the aggregate at the end:

```
Fan-out summary (N tickets):
  ✓ <id>: PASS — <subject>
  ✓ <id>: PASS-WITH-FOLLOWUPS (filed M discovered-from)
  ✗ <id>: FAIL — <reason>
```

The user decides what to do with failures (re-claim, fix manually, escalate).

### 5. Worktree cleanup

`isolation: worktree` auto-cleans worktrees that made no commits. Worktrees with commits stay until the user manually `git worktree remove`s them — that's intentional, the work is sitting on a branch waiting for review.

## When NOT to fan out

- The swarm has only 1 ready front. Just do serial.
- Tickets share state (database, config, generated files). Worktrees won't help; you'll get merge conflicts.
- Tests can't run in parallel (e.g., they bind to a fixed port). Run serial.
- The orchestrator's context is already heavy. Each sub-agent needs its own context budget; if you're already deep, the cost compounds.

## Integration with the planning menu

When the agent surfaces a planning menu and the user picks "fan out," that's the trigger to invoke this skill. The skill picks up from there. The user does NOT need to know the worktree mechanics — the agent handles spawn, isolate, verify, close, summarize.

## Forbidden actions

- Do NOT spawn more than 3 sub-agents concurrently. If the swarm has >3 ready fronts, do them in waves of 3 (after a wave completes, claim the next 3).
- Do NOT spawn sub-agents recursively. Sub-agents cannot spawn their own sub-agents.
- Do NOT commit or push from the orchestrator. The orchestrator usually sits on the parent branch (often `main`); sub-agents commit and push their own ticket branches from inside their worktrees.
- Do NOT auto-merge sub-agent branches. Merging is the user's call.
