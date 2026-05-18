---
name: scope-discipline
description: Track scope expansion through Backlog follow-up tasks instead of silent unrelated edits.
---

# Scope Discipline

Current task defines the work. Outside that task is separate work.

## Rule

When a fix touches files or behavior outside the current task:

1. Stop the out-of-scope edit.
2. Create a Backlog follow-up task.
3. Keep the current task focused.
4. Mention the follow-up ID in task notes or final summary.

```sh
backlog task create "<one-line title>" \
  --description "Found during <current-id>. <issue and expected fix>" \
  --priority medium \
  --dep <current-id> \
  --ac "WHEN ... THE SYSTEM SHALL ..."
```

## Out Of Scope

- Refactoring nearby code because it looks messy.
- Fixing unrelated bugs noticed in passing.
- Editing tests unrelated to the current behavior.
- Deleting files the task did not name.
- Expanding the task body after claim time to justify new edits.

## In Scope

- Tests for changed code.
- Config required by the current change.
- Docs reflecting the current change.
- Small file-path inference within the named module.

## Hard Rules

- Never silently fold separate work into the current task.
- File follow-up work before editing out-of-scope files.
- When uncertain, create the follow-up task and keep moving on the claimed work.
