---
description: Execute approved ready tracker work.
---

Follow the project `/work-next` skill exactly.

Execute approved ready tracker work through Worktrunk-managed implementation worktrees.

- Re-read ready work with `backlog task list -s "To Do" --plain` and `backlog task view <id> --plain`.
- Select only approved ready Backlog work.
- Use Worktrunk lifecycle under `.agents/worktrees/`.
- Run setup, verification, and teardown through the `mise run worktree:*` tasks.
- Implementation agents commit before returning.

Arguments: $ARGUMENTS
