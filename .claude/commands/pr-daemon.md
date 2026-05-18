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
- Pass `--spawn --agent codex` or `--spawn --agent claude` when the user wants immediate agent fixes in Worktrunk worktrees.
- Pass `--agent none` when the user only wants worktrees/tasks, not an agent run.
- Pass `--spawn-command` when a custom server-side launcher should run.
- Pass `--webhook-port` when the user wants GitHub review/comment webhooks instead of polling.
- Explain that the user talks to the daemon through PR comments/reviews; the daemon is the bridge to agent work.

Arguments: $ARGUMENTS
