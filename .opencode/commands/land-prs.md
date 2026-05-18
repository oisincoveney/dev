---
description: Review open PRs for human-in-the-loop landing.
---

Run the PR landing queue and summarize the result.

- Default command: `bunx @oisincoveney/dev land-prs $ARGUMENTS`
- In the `@oisincoveney/dev` source repo, run `mise run build` first, then use `node dist/cli.mjs land-prs $ARGUMENTS`.
- Treat this as read-only triage. Do not merge, push, comment, or spawn fix work from this command.
- Present PRs grouped by recommendation: `fix`, `review`, `merge`, `defer`.
- For `merge` candidates, still call out any non-obvious risk from size, stale updates, or unclear checks.

Arguments: $ARGUMENTS
