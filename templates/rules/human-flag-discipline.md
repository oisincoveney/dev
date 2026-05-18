---
name: human-flag-discipline
description: Decide when a worker must stop for user judgment and when to record a Backlog note instead.
---

# Human Flag Discipline

Workers should not interrupt the user for routine partials. Record state in Backlog and keep independent work moving.

## Stop And Ask Only When

1. A destructive operation needs explicit approval.
2. A core assumption is invalid and continuing would produce throwaway work.
3. Two user constraints conflict and the conflict cannot be resolved from repo context.

## Record In Backlog And Continue When

- A non-blocking verification check fails.
- A follow-up is needed outside current scope.
- A dependency is missing but unrelated work can continue.
- A task is partial but siblings can still finish.

Use:

```sh
backlog task edit <id> --append-notes "<short blocker or partial result with evidence>"
```

## Summary Format

```text
Fan-out summary:
  <id>: PASS - <evidence>
  <id>: PARTIAL - <reason in Backlog notes>
  <id>: FAIL - <blocking evidence>
```

## Hard Rules

- Do not page the user mid-flight for routine failures.
- Do not close a task that is waiting on user judgment.
- Put blocker evidence in Backlog notes with file paths and command results.
