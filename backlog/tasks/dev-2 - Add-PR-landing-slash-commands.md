---
id: DEV-2
title: Add PR landing slash commands
status: Done
assignee: []
created_date: '2026-05-18 12:43'
updated_date: '2026-05-18 12:49'
labels: []
dependencies: []
modified_files:
  - templates/commands/land-prs.md
  - templates/commands/pr-daemon.md
  - .claude/commands/land-prs.md
  - .claude/commands/pr-daemon.md
  - .codex/commands/land-prs.md
  - .codex/commands/pr-daemon.md
  - .opencode/commands/land-prs.md
  - .opencode/commands/pr-daemon.md
  - src/orchestrator.ts
  - src/__tests__/orchestrator.test.ts
  - src/__tests__/e2e-install.test.ts
  - .config/wt.toml
  - mise.toml
  - README.md
  - templates/hooks/destructive-command-guard.sh
priority: medium
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add generated slash-command wrappers for the PR landing workflow so installed repos expose /land-prs and /pr-daemon in supported agent runtimes, backed by the existing oisin-dev CLI.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Generated Claude command for land-prs and pr-daemon
- [x] #2 Generated OpenCode command for land-prs and pr-daemon
- [x] #3 Codex target receives equivalent command wrappers when supported by this harness
- [x] #4 Install/update tests verify generated command files
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added generated /land-prs and /pr-daemon command wrappers for Claude, OpenCode, and Codex targets. Added Codex command rendering, tests for generated command files, and dogfood workflow guard/instructions to prevent nested Worktrunk worktrees from relative paths. Verified with typecheck, focused tests, full test suite, and build.
<!-- SECTION:FINAL_SUMMARY:END -->
