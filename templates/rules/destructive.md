---
name: destructive
description: Destructive command policy, approvals, co-author trailer ban
---

# Destructive Operations

Blocked by hooks. Never attempt without explicit user approval:
- `git reset --hard`
- pushing to `main`, `master`, release branches, or tags
- `git clean -f`
- `rm -rf`
- `DROP TABLE` / `DROP DATABASE`
- `npm publish` / `yarn publish` / `bun publish` / `pnpm publish`

User-authorized destructive ops: ask each occurrence, not once per session.

Normal and force pushes are allowed on non-protected task/quick branches. Prefer `--force-with-lease` when rewriting a branch.

**No Co-Authored-By**: don't add `Co-Authored-By: Claude` to commits. Hook strips automatically.
