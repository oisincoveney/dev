---
name: quick
description: Explicit inline current-branch tiny edit. Use only when the user invokes /quick.
disable-model-invocation: true
---

# /quick

Use only when the user explicitly invokes `/quick [P2|P3] <task>`.

Rules:
- Defaults to P3; explicit P2 allowed; P0/P1 blocked.
- Stay in the current checkout and current branch. No Worktrunk setup. No delegated implementation agent.
- Read before editing.
- For external APIs, libraries, features, or current facts, use official docs/web first.
- Keep scope tiny and low-risk.
- Reject `/quick` for migrations, auth/security/billing/data-risk, broad refactors, generated files, new dependencies, releases, or ambiguous work.
- Run focused verification relevant to the edit.
- Commit the verified change on the current branch.

Arguments: `$ARGUMENTS`
