---
description: Approve reviewed tracker work.
---

Follow the project `/approve` skill exactly.

Approve reviewed tracker work and move it to ready. Do not implement.

- Re-read the tracker item.
- Hash the current title, description, priority, type, and `metadata.workflow.plan`.
- Store approval metadata in `metadata.workflow.approval`.

Tracker item: $ARGUMENTS
