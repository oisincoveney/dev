# @oisincoveney/dev

Opinionated AI development environment harness for multi-language projects. Copier owns template lifecycle, dotagents owns shared skill sync, mise owns tool installation and canonical commands, lefthook owns Git hooks, and Beads owns task/memory workflow state.

## What it does

Running `oisin-dev init` inside an existing project walks you through prompts, then renders the bundled Copier template and syncs tool-native overlays:

- **`.copier-answers.yml`** — Copier answer file used by `update` and `reset`
- **`AGENTS.md`** — canonical shared project instructions
- **`CLAUDE.md`** — Claude entrypoint pointing back to `AGENTS.md`
- **`.agents/skills/` + `agents.toml`** — canonical skills and dotagents metadata
- **`mise.toml`** — canonical project commands (`mise run test`, `mise run lint`, etc.)
- **`lefthook.yml`** — Git hooks (pre-commit, commit-msg, pre-push)
- **`.claude/`, `.codex/`, `.cursor/`, `.opencode/`** — native runtime overlays for each agent

The core philosophy: use proven tools for lifecycle and sync, while keeping the project-specific harness behavior explicit. Mechanical enforcement remains in hooks and linters; judgment-heavy guidance lives in `AGENTS.md` and skills.

## Install

```sh
npm install -g @oisincoveney/dev
```

Or run without installing:

```sh
npx @oisincoveney/dev init
```

## Commands

### `oisin-dev init`

Interactive setup for an existing project. Run inside a directory with `package.json`, `Cargo.toml`, `go.mod`, or `Package.swift` — scaffolding a new application is out of scope.

**Steps:**

1. **Detect** — Reads existing `package.json`, `Cargo.toml`, `go.mod`, or `Package.swift` to infer the project language and type. Exits with an error if none is present.

2. **Project type** — Selects from 15 variants across 4 languages:
   - TypeScript: `ts-frontend`, `ts-backend`, `ts-fullstack`, `ts-lib`, `ts-cli`, `ts-monorepo`
   - Rust: `rust-bin`, `rust-lib`, `rust-workspace`
   - Go: `go-bin`, `go-lib`, `go-workspace`
   - Swift: `swift-app`, `swift-lib`, `swift-package`

3. **Framework** — Context-sensitive list (React, Vue, Svelte, SvelteKit, Nuxt, Next.js, Remix, Hono, Express, Fastify, NestJS, SwiftUI, UIKit, etc.)

4. **Build commands** — Dev, build, test, typecheck, lint, format — auto-detected and emitted as `mise` tasks

5. **Rule skills** — Categories of coding standards to embed in AI instructions:
   - Code quality & strictness
   - Architecture (deep modules, layer boundaries, file size limits)
   - Testing (TDD, property-based testing, proof-of-work)
   - AI behavior (verify before claiming, no completion without proof)
   - Component patterns (frontend)
   - State management (frontend)
   - Styling & UI (frontend)
   - Performance

6. **Skills** — Canonical project skills under `.agents/skills/`, linked into tool-specific locations by dotagents

7. **Tools** — Beads (issue tracker), contract-driven modules

8. **Workflow** — `bd` (beads-as-source-of-truth: epic → ticket → /work-next → /verify-spec) or `none`

9. **AI targets** — Which tools to generate config for: Claude Code, Codex, OpenCode, Cursor, lefthook

10. **MCP servers** — Memory, Serena (codebase indexing), GitHub

11. **Claude model routing** — Assigns Claude models to task types only when the Claude target is selected.

### `oisin-dev update`

Runs `copier update --defaults`, then `dotagents install`, then `lefthook install`. It requires a clean Git worktree and does not delete generated agent directories.

```sh
oisin-dev update
```

### `oisin-dev reset`

Dangerous reset path for generated agent configuration. It prints the paths it will remove, requires confirmation unless `--yes` is passed, requires a clean Git worktree unless `--force` is passed, deletes generated agent overlays and root agent docs, then runs `copier recopy --force`, `dotagents install`, and `lefthook install`.

If `.copier-answers.yml` is missing but legacy `.dev.config.json` exists, reset first converts `.dev.config.json` into `.copier-answers.yml` so older repos can use the same clean-break reset path. It never deletes `.beads`.

```sh
oisin-dev reset
oisin-dev reset --yes
oisin-dev reset --force --yes
```

### `oisin-dev beads-migrate`

Adopts the repo-backed Dolt workflow for an existing Beads repo. It is idempotent: it points `sync.remote`, `federation.remote`, and `bd dolt remote origin` at the Git `origin` URL, sets `export.git-add` to `false`, ignores `.beads/issues.jsonl`, and removes `.beads/issues.jsonl` from Git tracking with `git rm --cached` when needed.

```sh
oisin-dev beads-migrate
```

Fresh clone flow for Beads-enabled repos:

```sh
git clone <repo>
bd bootstrap
bd dolt pull
```

Shared ticket state lives in `refs/dolt/data` in the same Git repo. Normal code commits should not include `.beads/issues.jsonl`.

### `oisin-dev tickets`

Launches the local Beads web UI for the current workspace by delegating to [`beads-ui`](https://github.com/mantoni/beads-ui). It works from non-JavaScript projects too; no `package.json` or project-local npm install is required.

```sh
bunx @oisincoveney/dev tickets --open
```

## Generated files

### Shared layer

- `AGENTS.md` — canonical always-on project policy.
- `.agents/skills/` — canonical project skills.
- `agents.toml` — lightweight agent metadata.
- `mise.toml` — canonical task definitions.

### Tool overlays

Claude, Codex, Cursor, and OpenCode keep native config under `.claude/`, `.codex/`, `.cursor/`, and `.opencode/`. These overlays wire the same harness behavior into each tool without forcing a single universal runtime format.

### Claude Code (`.claude/`)

**Hooks** (`post-tool-use`, `pre-tool-use`, `stop`, `notification`):

| Hook | Purpose |
|---|---|
| `context-bootstrap.sh` | Injects project context at session start |
| `context-injector.sh` | Injects project context on each prompt |
| `ts-style-guard.sh` | Blocks writes with `any`, magic numbers, bad names |
| `import-validator.sh` | Enforces layer boundary rules |
| `ai-antipattern-guard.sh` | Blocks missing `await`, wrong syntax |
| `destructive-command-guard.sh` | Requires explicit approval for `rm -rf`, force-push, `git reset --hard` |
| `block-coauthor.sh` | Removes `Co-Authored-By: Claude` from commits |
| `block-todowrite.sh` | Blocks TodoWrite tool (use Beads instead) |
| `post-edit-check.sh` | Verifies edited files compile |
| `pre-stop-verification.sh` | Blocks unsubstantiated "tests should pass" claims |
| `pr-size-check.sh` | Warns on oversized PRs |
| `tdd-guard.sh` | Enforces test-first order |

**Settings** (`.claude/settings.json`):
- Hook registrations with event bindings
- Tool permissions
- MCP server references

**Skills**:
Claude-specific skill locations are symlinked from `.agents/skills/` by `oisin-dev`.

### Lint and format configs

Generated from the Copier template with sensible defaults for each language. Use Git to review or recover changes after `update` or `reset`.

| Language | Files |
|---|---|
| TypeScript | `.eslintrc.json`, `.prettierrc.json`, `tsconfig.strict.json`, `.lintstagedrc.mjs` |
| Rust | `.rustfmt.toml`, `deny.toml` |
| Go | `.golangci.yml` |
| Swift | `.swiftlint.yml`, `.swiftformat.yml` |

### Tool configs

| File | Purpose |
|---|---|
| `.semgrep.yml` | Security linting rules |
| `.commitlintrc.json` | Commit message format enforcement |
| `dependency-cruiser.config.js` | Architecture boundary enforcement (TS) |
| `stryker.config.mjs` / `.cargo-mutants.toml` | Mutation testing |

## Configuration

Template answers are stored in `.copier-answers.yml`; shared skill/agent metadata lives in `agents.toml`; commands and required CLI tooling live in `mise.toml`:

```toml
# mise.toml
[tools]
"pipx:copier" = "9.14.0"
"npm:@sentry/dotagents" = "latest"
"aqua:evilmartians/lefthook" = "latest"

[tasks.test]
run = "bun test"

[tasks.typecheck]
run = "tsc --noEmit"

[tasks.lint]
run = "biome check ."
```

Use `oisin-dev update` for normal non-destructive template updates and `oisin-dev reset` for explicit destructive regeneration.

## Auto-detection

`oisin-dev init` reads your project before prompting:

- **Language**: presence of `package.json`, `Cargo.toml`, `go.mod`, or `Package.swift`
- **Package manager**: lockfile inspection (`bun.lock` → bun, `pnpm-lock.yaml` → pnpm, etc.)
- **Project variant**: inspects `dependencies` in `package.json` to distinguish frontend/backend/fullstack/library
- **Build commands**: reads `scripts` in `package.json` and maps common keys to command slots
- **Git remote**: if present, suggests GitHub MCP server

## Tech support

Supported language/variant combinations:

| Language | Variants |
|---|---|
| TypeScript | frontend, backend, fullstack, lib, CLI, monorepo |
| Rust | binary, library, workspace |
| Go | binary, library, workspace |
| Swift | app (SwiftUI/UIKit), library, package |

## Development

### Required tools

Runtime setup expects `mise`. Project-local `mise.toml` installs Copier, dotagents, lefthook, and `bd` when Beads is enabled, so users do not need to install those globally.

This repo's tests run against real `bd` for e2e coverage — they don't skip when it's missing. Install via [mise](https://mise.jdx.dev/) (preferred):

```sh
mise install   # reads mise.toml
```

Or install manually so `bd` is on PATH:

```sh
curl -sSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh | bash
```

If `bd` isn't on PATH, the e2e install tests fail fast with a clear error rather than silently skipping.

### Common commands

```sh
# Install dependencies
bun install

# Build
bun run build

# Test
bun test

# Watch mode
bun run test:watch
```

The CLI entry point is `src/cli.ts`, compiled to `dist/cli.mjs`. The programmatic API (`src/index.ts` → `dist/index.mjs`) is used by hook scripts and can be imported by other tools.

## License

MIT
