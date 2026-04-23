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
