---
description: Execute approved ready tracker work.
---

Follow the project `/work-next` skill exactly.

Execute approved ready tracker work through Worktrunk-managed implementation worktrees.

- Run `bd prime` after a fresh session or compaction.
- Select only approved ready tracker work.
- Use Worktrunk lifecycle under `.agents/worktrees/`.
- Run setup, verification, and teardown through the `mise run worktree:*` tasks.
- Implementation agents commit before returning.

Arguments: $ARGUMENTS
