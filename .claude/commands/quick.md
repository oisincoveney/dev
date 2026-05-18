---
description: Low-ceremony Worktrunk-managed quick task.
---

Follow the project `/quick` skill exactly.

Use only for explicit `/quick [P2|P3] <task>`.

- Create and use a Worktrunk-managed quick worktree.
- Do not edit in the current checkout.
- Default P3; allow explicit P2; reject P0/P1.
- Read before editing.
- Use relevant official docs/web first when external APIs, libraries, features, or current facts are involved.
- Reject migrations, auth/security/billing/data-risk, broad refactors, generated files, new dependencies, releases, or ambiguous work.
- Run normal verification relevant to the edit.
- Commit the verified change in the quick branch.

Task: $ARGUMENTS
