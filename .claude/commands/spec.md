---
description: Create a new spec file in .claude/specs/ for the current task
disable-model-invocation: true
allowed-tools: Bash(date *) Write Read
---

Create a new spec at `.claude/specs/YYYY-MM-DD-$ARGUMENTS.md` using the TEMPLATE.md in the same directory. Use today's date (from `date +%Y-%m-%d`) and the slug passed as `$ARGUMENTS`. Fill in the Overview and Success Criteria sections with your best inference from recent conversation, then stop — the user fills in the rest.

If `$ARGUMENTS` is empty, ask for a slug (kebab-case) and halt.
