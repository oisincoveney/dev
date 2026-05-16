---
name: plan
description: Create tracker-backed work in review state and stop. Use only when the user invokes /plan.
disable-model-invocation: true
---

# /plan

Use only when the user explicitly invokes `/plan [priority] <goal>`.

Create tracker-backed work in `review` state and stop. Do not implement.

Rules:
- Use the tracker shim where available: `oisin-dev tracker`.
- Store machine-readable workflow state in tracker metadata (`metadata.workflow` for beads), not disk plan files.
- Include priority rationale, files/areas, acceptance criteria, verification commands, and PR grouping if relevant.
- Single-task and multi-ticket plans both require review.
- Ask at most one non-trivial judgment question if the plan cannot be created safely.

Arguments: `$ARGUMENTS`
