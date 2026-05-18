---
id: DEV-1
title: Add PR landing CLI and daemon
status: Done
assignee: []
created_date: '2026-05-18 11:49'
updated_date: '2026-05-18 12:28'
labels: []
dependencies: []
modified_files:
  - src/cli.ts
  - src/pr-workflow.ts
  - src/__tests__/pr-workflow.test.ts
  - README.md
  - .gitignore
priority: medium
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement initial HITL CLI support for landing open PRs plus a local PR daemon that can detect review/comment events and enqueue automated agent fix work.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Provides CLI entrypoints for PR landing and daemon mode.
- [x] #2 Gathers PR metadata, comments, reviews, and checks using GitHub CLI.
- [x] #3 Keeps implementation aligned with Worktrunk and Backlog workflow.
- [x] #4 Includes targeted tests or verification.
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented land-prs and pr-daemon CLI commands, PR packetization, review/comment signal extraction, Backlog task enqueueing with dogfood fallbacks, docs, and focused tests. Verified with typecheck, full test suite, build, and command help execution.
<!-- SECTION:FINAL_SUMMARY:END -->
