---
id: DEV-3
title: Complete PR landing HITL workflow
status: Done
assignee: []
created_date: '2026-05-18 13:26'
updated_date: '2026-05-18 13:39'
labels: []
dependencies: []
modified_files:
  - src/pr-workflow.ts
  - src/__tests__/pr-workflow.test.ts
  - README.md
  - AGENTS.md
  - .gitignore
  - templates/commands/land-prs.md
  - templates/commands/pr-daemon.md
  - .claude/commands/land-prs.md
  - .claude/commands/pr-daemon.md
  - .codex/commands/land-prs.md
  - .codex/commands/pr-daemon.md
  - .opencode/commands/land-prs.md
  - .opencode/commands/pr-daemon.md
priority: medium
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Finish the original PR landing scope: interactive human-in-the-loop PR decisions, merge-on-approval support, richer PR context, daemon task spawning/queueing hooks, and dogfood workflow fixes so agents use the right tracker/worktree instructions.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Interactive land-prs mode can walk PRs and record approve/reject/fix/defer decisions.
- [x] #2 Approved PRs can be merged explicitly with guardrails.
- [x] #3 pr-daemon can enqueue or spawn follow-up work using the repo workflow instead of only printing signals.
- [x] #4 PR context includes review threads or full diff details beyond summary metadata where GitHub CLI supports it.
- [x] #5 Dogfood instructions no longer point this Backlog-backed repo at beads-only commands.
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Completed the missing PR landing scope: land-prs now supports interactive HITL decisions, richer gh pr view/diff context, guarded merge-on-approval, and decision recording; pr-daemon now supports dry-run-safe polling, Backlog task creation, Worktrunk/custom spawn commands, and webhook mode with optional GitHub HMAC validation. Updated slash-command templates/generated commands, docs, gitignore runtime state, and tests. Verified with typecheck, focused PR workflow tests, full test suite, build, and CLI help execution.
<!-- SECTION:FINAL_SUMMARY:END -->
