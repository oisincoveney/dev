---
name: tracker-workflow
description: Tracker-first workflow rules: quick lane, planning approval, worktree agents, graph execution, verification, and PR grouping.
---

# Tracker Workflow

Tracker is the single source of truth. Beads is the first adapter. Workflow state is JSON in `metadata.workflow`, accessed through `oisin-dev tracker`.

Main thread is always orchestrator. Worktrunk-managed isolated agent worktrees under `.agents/worktrees/<task-or-branch>` are required for `/work-next`, approved tracker work, multi-ticket work, delegated agents, and normal implementation tasks. Current checkout is allowed for answer-only, investigation-only, and explicit `/quick` inline edits.

Use `wt` for Worktrunk lifecycle. Do not use full repo clones, scratch directories, `/tmp`, `/private/tmp`, or `TMPDIR` overrides. Worktree setup, verification, and teardown run through `mise run worktree:setup`, `mise run worktree:verify`, and `mise run worktree:teardown`.

## Commands

- `/quick [P2|P3] <task>` — explicit inline current-branch tiny-edit lane. No tracker approval, no Worktrunk setup, focused verification only, commit on current branch.
- `/plan [priority] <goal>` — create tracker item in `review`; stop.
- `/approve <id>` — store approval hash; move item to `ready`.
- `/work-next` — execute approved ready tracker work.
- `/finish` — verify integration, group PRs, push/open PRs by branch rules.

## Approval

Approval hash covers normalized title, description, priority, issue type, and `metadata.workflow.plan`. It excludes runtime state, notes, comments, timestamps, assignee, branches, worktrees, commits, and PRs.

Any plan change after approval invalidates approval. Runtime and notes do not.

## Quick Gate

`/quick` defaults P3. Explicit `/quick P2` allowed. P0/P1 never quick.

Quick work must be explicitly invoked with `/quick`, bounded, low-risk, preceded by read-before-edit and relevant docs-first research, have a focused verification command, and avoid protected domains: migrations, auth/security/billing/data-risk, broad refactors, generated files, new dependencies, releases, ambiguous work, CI, public API/CLI/file-format contracts.

## Graph Work

Multi-ticket plans require exactly one real tracer/proof ticket. Parent approval creates children immediately. Ready children can run after `/work-next`; review children require approval.

`/work-next` fans out all mechanically independent ready children: graph-unblocked, non-overlapping file sets, no shared exclusive resource. No hard agent cap.

## Verification

Every tracked ticket close requires fresh-context verification. `/quick` uses normal verification only.

Verifier is read-only. P0-P2 findings become tracker tickets; simple/safe P3 findings are returned for implementer inline fix and recorded in notes.

## PR Reviewability

Multi-ticket plans include PR groups before execution. Soft review unit: about 400 changed lines or 8 files. Hard advisory: about 800 changed lines or 15 files. Exceeding hard advisory is allowed when planned/approved, mechanical, impossible to split coherently, or splitting makes review harder.
