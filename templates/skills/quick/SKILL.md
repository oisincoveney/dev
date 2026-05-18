---
name: quick
description: Low-ceremony Worktrunk-managed quick task. Use only when the user invokes /quick.
disable-model-invocation: true
---

# /quick

Use only when the user explicitly invokes `/quick [P2|P3] <task>`.

Rules:
- Defaults to P3; explicit P2 allowed; P0/P1 blocked.
- Create and use a Worktrunk-managed quick worktree under `.agents/worktrees/`.
- Do not edit in the current checkout.
- Read before editing.
- For external APIs, libraries, features, or current facts, use official docs/web first.
- Keep scope tiny and low-risk.
- Reject `/quick` for migrations, auth/security/billing/data-risk, broad refactors, generated files, new dependencies, releases, or ambiguous work.
- Run normal verification relevant to the edit.
- Commit the verified change in the quick branch.

Arguments: `$ARGUMENTS`
