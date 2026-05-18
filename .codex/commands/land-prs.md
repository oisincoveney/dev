---
description: Review open PRs for human-in-the-loop landing.
---

Run the PR landing queue and summarize the result.

- Default command: `bunx @oisincoveney/dev land-prs $ARGUMENTS`
- In the `@oisincoveney/dev` source repo, run `mise run build` first, then use `node dist/cli.mjs land-prs $ARGUMENTS`.
- Default usage is read-only triage. Only merge when the user passes `--merge-approved` or explicitly asks to merge approved PRs.
- Use `--interactive --details` for the HITL pass. Add `--diff` when the user wants patch context inline.
- Use `--merge-approved` during interactive approval, or `--merge-approved --auto-merge-ready` for non-interactive guarded merge of ready PRs.
- Present PRs grouped by recommendation: `fix`, `review`, `merge`, `defer`.
- For `merge` candidates, still call out any non-obvious risk from size, stale updates, or unclear checks.

Arguments: $ARGUMENTS
