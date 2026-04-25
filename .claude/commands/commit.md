---
description: Split current working changes into logical, focused commits
disable-model-invocation: true
allowed-tools: Bash(git *)
---

Split the current working tree into logical commits. Never dump everything into a single commit.

1. Run `git status` and `git diff` (and `git diff --cached`) to review all changes.
2. Group related hunks into logical commits — one concern per commit:
   - feat: new behavior
   - fix: bug fix
   - refactor: structure without behavior change
   - test: tests only
   - docs: documentation
   - chore: tooling, config, formatting
3. For each group, `git add -p` or `git add <specific files>` — never `git add -A`/`git add .`.
4. Write a conventional commit message: `<type>(<scope>): <subject>` under 70 chars, body explaining WHY not WHAT.
5. Never add Co-Authored-By trailers (blocked by hook).
6. Run `git log --oneline -10` after each commit to confirm.

Stop before pushing. The user pushes when they're ready.

If the diff is trivially one concern, one commit is fine — do not invent splits.
