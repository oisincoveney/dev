---
name: finish
description: Integrate verified tracker work, group PRs, and submit stacked PRs with git-spice by branch rules.
disable-model-invocation: true
---

# /finish

Use only when the user explicitly invokes `/finish`.

Integrate verified tracker work, compare actual diffs to approved PR groups, and submit stacked PRs with git-spice by branch rules.

Rules:
- Verify integrated work before claiming completion.
- Respect approved PR grouping; material unplanned divergence triggers re-plan before PR creation.
- Use `git-spice branch submit` or `git-spice stack submit` for non-protected task/quick branch PRs.
- Serialize `git-spice stack restack` and `git-spice stack submit` per stack; git-spice skips or avoids related branches that are checked out in other worktrees.
- Block pushes to `main`, `master`, release branches, and tags unless explicitly authorized.
- Mark Backlog tasks Done only after verification evidence is recorded in final summary or notes.

Arguments: `$ARGUMENTS`
