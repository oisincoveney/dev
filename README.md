# @oisincoveney/dev

Opinionated AI development harness for project-local agent workflows.

The harness has one source of truth:

- Generated policy and config are rendered by the TypeScript renderer in `src/orchestrator.ts`.
- Reusable skills live once in `templates/agent-assets/.agents/skills/`.
- Runtime hook scripts live once in `templates/hooks/` and install to `.agents/hooks/`.
- Tool-specific overlays under `.claude/`, `.codex/`, `.cursor/`, and `.opencode/` only wire native runtimes to those shared assets.
- Backlog.md is the task tracker for planned work.

## Install

Run without a global install:

```sh
bunx @oisincoveney/dev init
```

Or install the CLI:

```sh
bun add -g @oisincoveney/dev
oisin-dev init
```

## Commands

### `oisin-dev init`

Interactive setup for an existing project. It detects the project shape, writes the harness, installs declared tools through `mise`, syncs skills through `dotagents`, installs Git hooks through `lefthook`, and initializes Backlog when selected.

Generated project files include:

- `AGENTS.md` and `CLAUDE.md`
- `.agents/skills/` and `.agents/hooks/`
- `agents.toml`
- `mise.toml`
- `.config/wt.toml`
- `lefthook.yml`
- `.claude/`, `.codex/`, `.cursor/`, `.opencode/`

### `oisin-dev update`

Re-renders generated config from saved answers, refreshes shared hooks and skills, and reapplies tool setup. It requires a clean Git worktree.

```sh
oisin-dev update
```

### `oisin-dev reset`

Deletes generated agent paths, then writes a fresh harness from saved answers.

```sh
oisin-dev reset --yes
oisin-dev reset --force --yes
```

### `oisin-dev generate`

Renders generated files without running external installers. Use `--check` in CI to catch drift.

```sh
oisin-dev generate
oisin-dev generate --check
```

### `oisin-dev doctor`

Checks for generated drift, stale hook folders, stale tracker wording, missing shared hook runtime, and missing workflow skills.

```sh
oisin-dev doctor
oisin-dev doctor --fix
```

### `oisin-dev beads-to-backlog`

Imports existing Beads issues into Backlog task files while preserving original issue IDs, status, priority, dependencies, notes, and close summaries.

```sh
oisin-dev beads-to-backlog
```

## Worktrees

Generated projects require implementation work to happen in Worktrunk-managed Git worktrees:

```sh
WORKTRUNK_WORKTREE_PATH="$PWD/.agents/worktrees/{{ branch | sanitize }}" wt switch --create task/<id>-<slug>
mise run worktree:setup
mise run worktree:verify
mise run worktree:teardown
```

`.config/wt.toml` wires those tasks into Worktrunk lifecycle hooks.

## Generated Runtime

`AGENTS.md` is the canonical instruction file. Tool overlays are intentionally thin:

- Claude settings call `.agents/hooks/*.sh`.
- Codex hooks call `.agents/hooks/*.sh`.
- OpenCode plugin calls `.agents/hooks/*.sh`.
- Cursor receives rules and linked skills.
- Tool-specific skill directories are symlink farms pointing back to `.agents/skills/`.

This layout keeps adding hooks, rules, MCP servers, commands, and skills straightforward:

- Add or edit a hook once under `templates/hooks/`, then wire it from `claudeSettings`, `codexHooks`, or `opencodePlugin`.
- Add a reusable skill once under `templates/agent-assets/.agents/skills/`.
- Add a command once under `templates/agent-assets/.claude/commands/` or `.opencode/commands/` when the target runtime requires native command files.
- Add generated config fields in `TemplateData`, then render the target-specific overlay from that data.
- Add verification in `src/__tests__/` for the generated file and `doctor` drift check.

## Development

```sh
mise install
bun install
mise run typecheck
mise run test
mise run build
```

The CLI entry point is `src/cli.ts`, compiled to `dist/cli.mjs`.

## License
