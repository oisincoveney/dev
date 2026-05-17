---
name: tracker-workflow
description: Tracker-first workflow rules: quick lane, planning approval, worktree agents, graph execution, verification, and PR grouping.
---

# Tracker Workflow

Tracker is the single source of truth. Beads is the first adapter. Workflow state is JSON in `metadata.workflow`, accessed through `oisin-dev tracker`.

Main thread is always orchestrator. All implementation runs in Worktrunk-managed isolated agent worktrees under `.agents/worktrees/<task-or-branch>`, including `/quick`.

Use `wt` for worktree lifecycle. Do not use full repo clones, scratch directories, `/tmp`, `/private/tmp`, or `TMPDIR` overrides for agent implementation work. Worktree setup, verification, and teardown run through `mise run worktree:setup`, `mise run worktree:verify`, and `mise run worktree:teardown`.

Worktrunk owns worktree lifecycle. git-spice owns stack-aware branch creation, checkout, tracking, restacking, commit creation/amendment, branch publication, and PR creation/update. Direct `git`/`gh` commands for git-spice-owned operations are blocked. git-spice is worktree-aware, so serialize stack mutation commands per stack when other Worktrunk worktrees may have related branches checked out.

## Commands

- `/quick [P2|P3] <task>` — no tracker approval, normal verification only, implementation agent in Worktrunk quick worktree, commit with git-spice, merge back when verified.
- `/plan [priority] <goal>` — create tracker item in `review`; stop.
- `/approve <id>` — store approval hash; move item to `ready`.
- `/work-next` — execute approved ready tracker work.
- `/finish` — verify integration, group PRs, submit stacked PRs with git-spice by branch rules.

## Approval

Approval hash covers normalized title, description, priority, issue type, and `metadata.workflow.plan`. It excludes runtime state, notes, comments, timestamps, assignee, branches, worktrees, commits, and PRs.

Any plan change after approval invalidates approval. Runtime and notes do not.

## Quick Gate

`/quick` defaults P3. Explicit `/quick P2` allowed. P0/P1 never quick.

Quick work must be explicitly invoked with `/quick`, bounded, low-risk, have a normal verification command, and avoid protected domains: migrations, auth/security/billing/data-risk, broad refactors, generated files, new dependencies, releases, ambiguous work, CI, public API/CLI/file-format contracts.

## Graph Work

Multi-ticket plans require exactly one real tracer/proof ticket. Parent approval creates children immediately. Ready children can run after `/work-next`; review children require approval.

`/work-next` fans out all mechanically independent ready children: graph-unblocked, non-overlapping file sets, no shared exclusive resource. No hard agent cap.

## Verification

Every tracked ticket close requires fresh-context verification. `/quick` uses normal verification only.

Verifier is read-only. P0-P2 findings become tracker tickets; simple/safe P3 findings are returned for implementer inline fix and recorded in notes.

## PR Reviewability

Multi-ticket plans include PR groups before execution. Soft review unit: about 400 changed lines or 8 files. Hard advisory: about 800 changed lines or 15 files. Exceeding hard advisory is allowed when planned/approved, mechanical, impossible to split coherently, or splitting makes review harder.
