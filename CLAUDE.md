<!-- BEGIN @oisincoveney/dev managed block -->
# Project Instructions for AI Agents

This project is configured with @oisincoveney/dev. Hooks enforce most rules mechanically. Detailed rules live in `.claude/rules/` — Claude Code loads them automatically (always for unscoped rules, when matching files are read for path-scoped rules).

## Critical Rules (always active)

- Never run destructive commands without explicit user approval — blocked by hook.
- Read before editing; verify before claiming done.
- Confident wrong answers are worse than honest uncertainty. Say "I need to verify" and check.
- Treat user constraints as non-negotiable; do not reinterpret.
- No follow-up questions like "Want me to...". If done, stop.
- Do not write "this works", "this should work", or "done" without having run the test command and seen passing output. The Stop hook enforces this.
- Ask one non-trivial question at a time — stacking multiple judgment-call questions is not OK.

## Detailed Rules

See `.claude/rules/` for the full set. Topic files (`architecture.md`, `testing.md`, `ai-behavior.md`, etc.) load every session. Path-scoped files (`component-patterns.md`, `styling-ui.md`, `contract-driven.md`) load only when Claude reads matching files — editing a `.tsx` file pulls in the frontend rules automatically.

<!-- END @oisincoveney/dev managed block -->


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files
- Committing is always fine — on a ticket branch, a worktree, or directly on `main`. On a ticket branch or worktree the agent also pushes freely (that's the sandbox). Pushing `main` / `master` and any force-push still require explicit user approval.
<!-- END BEADS INTEGRATION -->
