<!-- BEGIN @oisincoveney/dev managed block -->
# Project Instructions for AI Agents

Configured with @oisincoveney/dev. Hooks enforce most rules mechanically. Detailed rules in `.claude/rules/` — Claude Code auto-loads (always for unscoped, on matching file read for path-scoped).

## Critical Rules (always active)

- Never run destructive commands without explicit user approval — blocked by hook.
- Read before editing; verify before claiming done.
- Confident wrong > honest uncertain — false. Say "I need to verify", check.
- User constraints non-negotiable. Don't reinterpret.
- No follow-up questions like "Want me to...". Done → stop.
- Don't write "this works"/"should work"/"done" without running test cmd + seeing pass. Stop hook enforces.
- One non-trivial question at a time. Stacking judgment-call questions = not OK.

## Detailed Rules

See `.claude/rules/` for full set. Topic files (`architecture.md`, `testing.md`, `ai-behavior.md`, etc.) load every session. Path-scoped (`component-patterns.md`, `styling-ui.md`, `contract-driven.md`) load only on matching file read — editing `.tsx` pulls frontend rules automatically.

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
- Pushing to remote is the user's call, not the agent's. Project policy stands: never push without explicit user approval.
<!-- END BEADS INTEGRATION -->
