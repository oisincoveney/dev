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
- Hash the current title, description, priority, type, and `metadata.workflow.plan`.
- Store approval metadata in `metadata.workflow.approval`.
- Do not implement. Execution happens through `/work-next`.

Arguments: `$ARGUMENTS`
