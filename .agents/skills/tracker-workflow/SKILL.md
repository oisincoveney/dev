---
name: tracker-workflow
description: Tracker-first development workflow for @oisincoveney/dev. Use for /quick, /plan, /approve, /work-next, /finish, tracker-backed work, worktree agent execution, and PR grouping.
---

# Tracker Workflow

The tracker is the single source of truth. Beads is the first-class tracker adapter. Machine-readable workflow state lives in `metadata.workflow` JSON and is accessed through `oisin-dev tracker`.

Main thread is always orchestrator. All implementation happens in Worktrunk-managed isolated agent worktrees under `.agents/worktrees/<task-or-branch>`, including `/quick`.

Use `wt` for agent worktree lifecycle. Do not create full clones, scratch directories, `/tmp` or `/private/tmp` workspaces, or `TMPDIR` overrides for agent implementation work. Worktree setup, verification, and teardown must run through `mise run worktree:setup`, `mise run worktree:verify`, and `mise run worktree:teardown`.

## Commands

- `/quick [P2|P3] <task>` — low-ceremony path. Defaults to P3; explicit P2 allowed. Never P0/P1. Dispatch a quick implementation agent in a Worktrunk worktree for `quick/p3/<slug>` or `quick/p2/<slug>`. Run normal verification, commit with git-spice, merge back after verification, resolve conflicts if still quick, then submit with git-spice when branch rules allow.
- `/plan [priority] <goal>` — create tracker item in `review` state and stop. Single-task and multi-ticket plans both require review.
- `/approve <id>` — hash current title, description, priority, type, and `metadata.workflow.plan`; store approval and move item to `ready`.
- `/work-next` — execute approved ready tracker work through implementation agents.
- `/finish` — verify integrated work, group PRs per approved PR plan, submit stacked PRs with git-spice by branch rules.

Natural language handles rejection, regrill, reprioritize, split, merge, defer, and verifier reruns.

## Tracker Metadata

Use `metadata.workflow`:

```json
{
  "schema": 1,
  "kind": "quick|task|plan|child",
  "state": "draft|review|ready|in_progress|blocked|closed",
  "plan": {
    "summary": "",
    "priority_rationale": "",
    "files": [],
    "acceptance": [],
    "verify": [],
    "graph": null,
    "pr_groups": []
  },
  "approval": {
    "hash": null,
    "approved_at": null,
    "approved_by": null
  },
  "runtime": {
    "branch": null,
    "worktree": null,
    "agent": null,
    "commits": [],
    "prs": []
  }
}
```

`plan` is approved scope. `runtime` is mutable execution/audit state. Notes/comments hold verifier output, P3 inline fixes, priority changes, and PR grouping divergence.

## Priority Rubric

- P0: production outage, data loss/corruption, security vulnerability, blocked release, irreversible user harm.
- P1: major user-facing breakage, broken core workflow, high-risk infrastructure, contractual/compliance deadline, serious regression without workaround.
- P2: normal product/engineering work, important bug with workaround, medium-risk refactor, planned improvement, multi-step implementation.
- P3: polish, minor bug, low-risk cleanup, docs/copy, small test improvement, local dev ergonomics.

User priority wins. Agent priority changes require a tracker note with reason.

## Single vs Multi-Ticket

Single task when all true: one coherent outcome, one agent can finish it, no more than two source areas, no staged rollout, no separate migration/setup/release step, no independent slices, one verification command set, one focused session.

Multi-ticket plan when any true: two or more useful slices, three or more source areas, needs tracer/proof, crosses durable layers, has migration/rollout/backfill/release choreography, benefits from multiple agents, needs architecture approval, spans sessions, or has separable risks/verification.

False-positive reducers: one file plus test is never multi-ticket; one bug with one repro defaults single-task even across two files. If no meaningful tracer exists, split the plan.

## Multi-Ticket Rules

Every graph has exactly one real tracer/proof ticket. Parent approval creates children immediately. Children that faithfully instantiate the approved plan start `ready`; children adding decisions/scope start `review`.

`/work-next` computes the ready wave and dispatches one agent per mechanically independent child: unblocked in graph, no overlapping declared file sets, no shared exclusive resource. No hard three-agent cap. Platform/resource limits may reduce the wave.

Serial graph work still uses one focused agent per task in dependency order.

## Verification

`/quick` uses normal verification only. Every tracked ticket close requires fresh-context verification.

Verifier is read-only:
- Original AC failure blocks close.
- P0-P2 outside-scope findings become tracker tickets; in graph context, attach to the graph/swarm.
- Simple/safe P3 findings may be fixed inline by implementer in any parent priority and recorded in verifier/close notes.
- P3 findings that are not simple/safe become tracker tickets.

## PR Grouping

Multi-ticket `/plan` must include PR groups before execution. Reviewability is planned up front.

Soft review unit: about 400 changed lines or 8 files. Hard advisory: about 800 changed lines or 15 files. Hard advisory can be exceeded when planned/approved, mechanical, impossible to split coherently, or splitting makes review harder.

Mechanical broad edits must be explicit in `pr_groups` with rationale and verification. `/finish` compares actual diffs to planned groups; material unplanned divergence triggers re-plan before PR creation.

## Branch and Push Rules

Worktrunk owns worktree lifecycle. git-spice owns stack-aware branch creation, checkout, tracking, restacking, commit creation/amendment, branch publication, and PR creation/update. Direct `git`/`gh` commands for git-spice-owned operations are blocked by hooks.

Branches:
- `/quick`: `quick/p3/<slug>` or `quick/p2/<slug>`
- tracked task/child: `task/<id>-<slug>`
- collisions append `-2`, `-3`, etc.

Implementation agents commit with `git-spice commit create` or `git-spice commit amend` before returning. Worktrees end clean. Canonical path is `.agents/worktrees/<branch-sanitized>`; `.claude/worktrees/` and `.codex/worktrees/` are compatibility roots only.

Use `git-spice branch submit` or `git-spice stack submit` for non-protected task/quick branch PRs. Serialize `git-spice stack restack` and `git-spice stack submit` per stack. Block pushes to `main`, `master`, release branches, and tags unless explicitly authorized.
