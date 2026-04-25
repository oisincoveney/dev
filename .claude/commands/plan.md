---
description: Produce a written plan for a multi-file or architectural change; no edits
disable-model-invocation: true
allowed-tools: Read Grep Glob Bash(rg *) Write
---

Write a plan at `.claude/plans/YYYY-MM-DD-$ARGUMENTS.md` (create the directory if missing) for the task `$ARGUMENTS`. No source-code Edit/Write until the user approves the plan.

The plan MUST contain:

1. **Goal** — one sentence: what the user wants, stated as an outcome.
2. **Root cause / requirement** — why this change, not symptoms.
3. **Files to change** — every file, with a one-line reason per file. If you don't know the file exists, read the tree first.
4. **Order of operations** — which edit happens first, and why that order (e.g., contract before callers, tests before implementation if TDD).
5. **What you verified** — docs read (with URLs), code traced (with `file:line`), commands run.
6. **Risks** — what could go wrong, what you'll do to mitigate.
7. **Out of scope** — what this plan will NOT touch, to prevent scope creep.

If `$ARGUMENTS` is empty, ask for a slug (kebab-case) and halt.

After writing, print the plan path and stop. Wait for user approval before any code edit.
