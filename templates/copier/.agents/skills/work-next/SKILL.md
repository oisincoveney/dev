---
name: work-next
description: Execute approved ready tracker work through Worktrunk-managed implementation worktrees.
disable-model-invocation: true
---

# /work-next

Use only when the user explicitly invokes `/work-next`.

Execute approved ready tracker work through Worktrunk-managed implementation worktrees under `.agents/worktrees/<task-or-branch>`.

Rules:
- Run `bd prime` when starting after a fresh session or compaction.
- Select approved ready work from the tracker.
- For each implementation task, use Worktrunk lifecycle under `.agents/worktrees/`.
- Run `mise run worktree:setup`, relevant verification, and `mise run worktree:teardown`.
- Implementation agents commit before returning.
- Do not use full clones, scratch directories, `/tmp`, `/private/tmp`, or `TMPDIR` overrides.

Arguments: `$ARGUMENTS`
