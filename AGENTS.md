# Project Instructions for AI Agents

Configured with @oisincoveney/dev. Shared rules live here; reusable playbooks live in `.agents/skills/`; tool-specific runtime wiring lives in native overlays.

## Critical Rules

- Use the tracker workflow for planned work; Backlog.md is the source of truth.
- Main thread is the orchestrator. All implementation, including `/quick`, runs in Worktrunk-managed agent worktrees; tracker metadata is the source of truth.
- `/quick [P2|P3] <task>` is the only low-ceremony lane. It still runs in a Worktrunk-managed agent worktree, verifies, commits, and may push/PR when branch rules allow.
- `/plan [priority] <goal>` creates tracker-backed work in review state and stops. `/approve <id>` unlocks it; `/work-next` executes approved ready work; `/finish` integrates verified work.
- Tracker data is canonical. Store workflow state in Backlog task fields: status, priority, dependencies, plan, notes, acceptance criteria, Definition of Done, and final summary.
- Use `backlog task ...` directly for tracker operations; use `backlog board` or `backlog browser --no-open` for local visibility.
- Never run destructive commands without explicit user approval.
- Agent implementation work must use Worktrunk (`wt`) git worktrees under `.agents/worktrees/<task-or-branch>`; full clones, scratch directories, `/tmp`, `/private/tmp`, and `TMPDIR` overrides are forbidden.
- Worktree setup, verification, and teardown must run through `mise run worktree:setup`, `mise run worktree:verify`, and `mise run worktree:teardown`.
- Worktrunk owns worktree lifecycle; git-spice owns stack-aware branch, commit, restack, push, and PR operations. Direct `git`/`gh` commands for git-spice-owned operations are blocked.
- Use `git-spice` in project automation; local aliases like `gs` are fine for humans.
- Read before editing; verify before claiming done.
- Say "I need to verify" when uncertain, then check.
- User constraints are non-negotiable.
- Do not write "works", "should work", or "done" without running the relevant verification command and seeing it pass.
- Ask one non-trivial judgment question at a time.
- Caveman mode is the default communication style. Keep responses terse unless the user says "normal mode" or clarity requires full wording.
- Intent gate: question means answer only; investigate/research means report only; `/quick` means Worktrunk quick worktree; `/work-next` or approved tracker work means Worktrunk implementation.
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

- Skills: `.agents/skills/`, linked into tool-specific locations by @oisincoveney/dev.
- Git hooks: `lefthook.yml`.
- Commands/tool versions: `mise.toml`.
- Worktree lifecycle: Worktrunk project hooks in `.config/wt.toml`; canonical agent root is `.agents/worktrees/`.
- Stack lifecycle: git-spice tracks branch relationships and submits stacked PRs; serialize stack mutation commands per stack.
- Runtime overlays: `.claude/`, `.codex/`, `.cursor/`, `.opencode/`.

## Backlog Quick Reference

```bash
backlog task list -s "To Do" --plain
backlog task list -s "In Progress" --plain
backlog task view <id> --plain
backlog task create "Title" --description "Why this exists" --priority medium --ac "Acceptance criterion"
backlog task edit <id> -s "In Progress" --plan "Implementation plan"
backlog task edit <id> --append-notes "Progress note"
backlog task edit <id> -s Done --final-summary "What changed and how it was verified"
backlog board
backlog browser --no-open
```
