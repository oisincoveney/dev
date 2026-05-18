---
description: Poll PR feedback and enqueue Backlog fix tasks.
---

Run the PR feedback daemon.

- Default command when no arguments are provided: `bunx @oisincoveney/dev pr-daemon --once --dry-run`
- With arguments: `bunx @oisincoveney/dev pr-daemon $ARGUMENTS`
- In the `@oisincoveney/dev` source repo, run `mise run build` first, then use `node dist/cli.mjs pr-daemon ...`.
- Do not run continuous daemon mode unless the user explicitly asks for it or passes interval/daemon arguments.
- Prefer `--once --dry-run` first, report exactly what would be enqueued, then wait for approval before creating tasks.
- When creating tasks, keep the daemon state file at `.agents/pr-daemon-state.json`.

Arguments: $ARGUMENTS
