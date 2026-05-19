---
description: Low-ceremony quick task.
---

Follow the project `/quick` skill exactly.

Use only for explicit `/quick [P2|P3] <task>` or `/quick --here [P3] <task>`.

- Default `/quick` creates and uses a Worktrunk-managed quick worktree.
- `/quick --here` is P3-only and uses the current checkout after inspecting dirty state.
- Default P3; allow explicit P2; reject P0/P1.
- Read before editing.
- Use relevant official docs/web first when external APIs, libraries, features, or current facts are involved.
- Reject migrations, auth/security/billing/data-risk, broad refactors, generated files, new dependencies, releases, or ambiguous work.
- Run normal verification relevant to the edit.
- Commit the verified change in the quick branch for default `/quick`; leave `/quick --here` uncommitted unless the user explicitly asks for a commit.

Task: $ARGUMENTS
