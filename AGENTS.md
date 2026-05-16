# Project Instructions for AI Agents

Configured with @oisincoveney/dev. Shared rules live here; reusable playbooks live in `.agents/skills/`; tool-specific runtime wiring lives in native overlays.

## Critical Rules

- Use the tracker workflow for planned work; beads is the first tracker adapter.
- Main thread is the orchestrator. Implementation agents use Worktrunk for planned/tracker-backed execution; tracker metadata is the source of truth.
- `/quick [P2|P3] <task>` is the explicit inline current-branch tiny-edit lane. It defaults P3; explicit P2 is allowed; P0/P1 are blocked. It requires read-before-edit, relevant docs-first research, focused verification, and a commit. No Worktrunk setup for `/quick`.
- `/plan [priority] <goal>` creates tracker-backed work in review state and stops. `/approve <id>` unlocks it; `/work-next` executes approved ready work; `/finish` integrates verified work.
- Tracker data is canonical. Store machine-readable workflow state in tracker metadata (`metadata.workflow` for beads), not disk plan files.
- Run `bd prime` for workflow context when starting or after compaction.
- Use `bd remember` for persistent knowledge. Do not create MEMORY.md files.
- Do not commit `.beads/issues.jsonl`; shared ticket state lives in repo-backed Dolt refs.
- Never run destructive commands without explicit user approval.
- Worktrunk (`wt`) git worktrees under `.agents/worktrees/<task-or-branch>` are required for `/work-next`, approved tracker work, multi-ticket work, delegated agents, and normal implementation tasks. Current checkout is allowed for answer-only, investigation-only, and explicit `/quick` inline edits. Full clones, scratch directories, `/tmp`, `/private/tmp`, and `TMPDIR` overrides are forbidden.
- Worktree setup, verification, and teardown must run through `mise run worktree:setup`, `mise run worktree:verify`, and `mise run worktree:teardown`.
- Read before editing; verify before claiming done.
- Say "I need to verify" when uncertain, then check.
- User constraints are non-negotiable.
- Do not write "works", "should work", or "done" without running the relevant verification command and seeing it pass.
- Ask one non-trivial judgment question at a time.
- Caveman mode is the default communication style. Keep responses terse unless the user says "normal mode" or clarity requires full wording.
- Intent gate: question means answer only; investigate/research means report only; `/quick` means inline tiny edit; `/work-next` or approved tracker work means Worktrunk implementation.
- Research gate: for external APIs, libraries, features, or current facts, use official docs/web first, first-party project source second, and dependency/generated files only as last resort.
- Do not end with follow-up prompts like "want me to", "should I", "let me know if", or "if you want". State the result and stop unless blocked.

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
- Worktree lifecycle: Worktrunk project hooks in `.config/wt.toml`; canonical agent root is `.agents/worktrees/`.
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
