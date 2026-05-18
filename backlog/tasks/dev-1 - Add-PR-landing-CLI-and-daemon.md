---
id: DEV-1
title: Add PR landing CLI and daemon
status: To Do
assignee: []
created_date: '2026-05-18 11:49'
labels: []
dependencies: []
priority: medium
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement initial HITL CLI support for landing open PRs plus a local PR daemon that can detect review/comment events and enqueue automated agent fix work.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Provides CLI entrypoints for PR landing and daemon mode.
- [ ] #2 Gathers PR metadata, comments, reviews, and checks using GitHub CLI.
- [ ] #3 Keeps implementation aligned with Worktrunk and Backlog workflow.
- [ ] #4 Includes targeted tests or verification.
<!-- AC:END -->
