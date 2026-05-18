---
id: DEV-4
title: Make pr-daemon launch real agents
status: Done
assignee: []
created_date: '2026-05-18 14:03'
updated_date: '2026-05-18 14:08'
labels: []
dependencies: []
modified_files:
  - src/pr-workflow.ts
  - src/__tests__/pr-workflow.test.ts
  - README.md
  - templates/commands/pr-daemon.md
  - .claude/commands/pr-daemon.md
  - .codex/commands/pr-daemon.md
  - .opencode/commands/pr-daemon.md
priority: medium
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fix pr-daemon so it directly launches configured agents from PR feedback instead of only creating tasks/worktrees or requiring an opaque custom command. Dogfood the intended server use case.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 pr-daemon exposes a first-class --agent option for supported local agent CLIs.
- [x] #2 Spawned agent command runs inside the generated Worktrunk worktree with a concrete PR feedback prompt.
- [x] #3 Docs explain how to run the daemon on an SSH server and how to interact via PR comments/reviews.
- [x] #4 Tests cover built-in agent command generation and dry-run output.
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Changed pr-daemon spawn from a worktree/custom-command primitive into a first-class agent launcher. --spawn now runs a generated PR feedback prompt in the Worktrunk worktree using --agent auto|codex|claude|none, with auto preferring Codex then Claude. Kept --spawn-command for custom server launchers. Updated README and generated command guidance to explain SSH-server operation and that users interact through PR comments/reviews. Verified with typecheck, focused PR workflow tests, full test suite, build, and CLI help smoke.
<!-- SECTION:FINAL_SUMMARY:END -->
