---
name: finish
description: Integrate verified tracker work, group PRs, and push/open PRs by branch rules.
disable-model-invocation: true
---

# /finish

Use only when the user explicitly invokes `/finish`.

Integrate verified tracker work, compare actual diffs to approved PR groups, and push/open PRs by branch rules.

Rules:
- Verify integrated work before claiming completion.
- Respect approved PR grouping; material unplanned divergence triggers re-plan before PR creation.
- Allow normal and force pushes on non-protected task/quick branches.
- Block pushes to `main`, `master`, release branches, and tags unless explicitly authorized.
- Close tracker items only after verification evidence is recorded.

Arguments: `$ARGUMENTS`
