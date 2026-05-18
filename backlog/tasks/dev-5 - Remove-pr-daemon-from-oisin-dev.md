---
id: DEV-5
title: Remove pr-daemon from oisin-dev
status: Done
assignee: []
created_date: '2026-05-18 14:18'
updated_date: '2026-05-18 17:27'
labels: []
dependencies: []
modified_files:
  - .claude/commands/pr-daemon.md
  - .codex/commands/pr-daemon.md
  - .gitignore
  - .opencode/commands/pr-daemon.md
  - README.md
  - src/cli.ts
  - src/pr-workflow.ts
  - src/__tests__/e2e-install.test.ts
  - src/__tests__/orchestrator.test.ts
  - src/__tests__/pr-workflow.test.ts
  - templates/commands/pr-daemon.md
priority: medium
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Remove the long-running PR daemon runtime from this package. Keep the PR landing CLI surface only where it belongs as a reusable command, and remove daemon command wiring, docs, slash-command wrappers, and tests.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 pr-daemon is no longer exposed by the oisin-dev CLI.
- [x] #2 Daemon runtime code, webhook/polling state handling, and agent-spawn code are removed from this repo.
- [x] #3 Generated command templates and installed overlays no longer include pr-daemon.
- [x] #4 Docs and tests reflect that only land-prs remains here.
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Removed pr-daemon from @oisincoveney/dev: deleted CLI dispatch/help exposure, daemon runtime code, polling/webhook/state handling, agent-spawn helpers, generated slash-command templates/overlays, README daemon docs, and the daemon state ignore entry. Kept land-prs as the reusable HITL PR landing command. Updated tests to assert generated installs no longer include pr-daemon and verified typecheck, focused tests, full test suite, build, and CLI smoke where pr-daemon is rejected as unknown.
<!-- SECTION:FINAL_SUMMARY:END -->
