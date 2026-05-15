# Project Instructions for AI Agents

Configured with @oisincoveney/dev. Shared rules live here; reusable playbooks live in `.agents/skills/`; tool-specific runtime wiring lives in native overlays.

## Critical Rules

- Use the tracker workflow for planned work; beads is the first tracker adapter.
- `/quick [P2|P3] <task>` is the only low-ceremony lane. It still runs in an agent worktree, verifies, commits, and may push/PR when branch rules allow.
- `/plan [priority] <goal>` creates tracker-backed work in review state and stops. `/approve <id>` unlocks it; `/work-next` executes approved ready work; `/finish` integrates verified work.
- Tracker data is canonical. Store machine-readable workflow state in tracker metadata (`metadata.workflow` for beads), not disk plan files.
- Run `bd prime` for workflow context when starting or after compaction.
- Use `bd remember` for persistent knowledge. Do not create MEMORY.md files.
- Do not commit `.beads/issues.jsonl`; shared ticket state lives in repo-backed Dolt refs.
- Never run destructive commands without explicit user approval.
- Read before editing; verify before claiming done.
- Say "I need to verify" when uncertain, then check.
- User constraints are non-negotiable.
- Do not write "works", "should work", or "done" without running the relevant verification command and seeing it pass.
- Ask one non-trivial judgment question at a time.

## Commands

Use `mise run <task>` for canonical project commands.

- `mise run build` -> `bun run build`
- `mise run dev` -> `bun run test:watch`
- `mise run format` -> `echo "no format configured"`
- `mise run lint` -> `echo "no lint configured"`
- `mise run test` -> `bun test`
- `mise run typecheck` -> `tsc --noEmit`


## Tooling

- Skills: `.agents/skills/`, linked into tool-specific locations by dotagents.
- Git hooks: `lefthook.yml`.
- Commands/tool versions: `mise.toml`.
- Runtime overlays: `.claude/`, `.codex/`, `.cursor/`, `.opencode/`.

## Beads Quick Reference

```bash
oisin-dev tracker show <id>
oisin-dev tracker approve <id>
bd ready
bd show <id>
bd update <id> --claim
bd close <id> --reason "<why>"
bd dolt pull
bd dolt push
```
