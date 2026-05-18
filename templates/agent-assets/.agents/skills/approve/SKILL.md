---
name: approve
description: Approve a reviewed tracker plan and move it to ready. Use only when the user invokes /approve.
disable-model-invocation: true
---

# /approve

Use only when the user explicitly invokes `/approve <id>`.

Approve the current reviewed tracker plan and move it to `ready`.

Rules:
- Re-read the tracker item before changing it.
- Verify the plan, acceptance criteria, dependencies, and priority still match the user's intent.
- Promote the Backlog task from draft/review into ready work by setting status to `To Do` and appending an approval note.
- Do not implement. Execution happens through `/work-next`.

Arguments: `$ARGUMENTS`
