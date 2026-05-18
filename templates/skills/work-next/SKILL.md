---
name: work-next
description: Execute approved ready tracker work through Worktrunk-managed implementation worktrees.
disable-model-invocation: true
---

# /work-next

Use only when the user explicitly invokes `/work-next`.

Execute approved ready tracker work through Worktrunk-managed implementation worktrees under `.agents/worktrees/<task-or-branch>`.

Rules:
- Run `backlog task list -s "To Do" --plain` and re-read the selected task with `backlog task view <id> --plain`.
- Select approved ready work from Backlog.md.
- Mark claimed work with `backlog task edit <id> -s "In Progress"`.
- For each implementation task, use Worktrunk lifecycle under `.agents/worktrees/`.
- Run `mise run worktree:setup`, relevant verification, and `mise run worktree:teardown`.
- Implementation agents commit before returning.
- Do not use full clones, scratch directories, `/tmp`, `/private/tmp`, or `TMPDIR` overrides.

Arguments: `$ARGUMENTS`
