# @oisincoveney/dev

Opinionated AI development environment generator for multi-language projects. Installs hooks, lint configs, AI agent instructions, git workflow enforcement, and project-local skills — all from a single command.

## What it does

Running `oisin-dev init` inside an existing project walks you through a series of prompts, then writes a consistent set of files:

- **`.dev.config.json`** — single source of truth for all generated content
- **`.claude/`** — hooks, settings, docs, and skills for Claude Code
- **`CLAUDE.md` / `AGENTS.md`** — instruction files for AI agents
- **`lefthook.yml`** — git hooks (pre-commit, commit-msg, pre-push)
- **Lint/format configs** — ESLint, Prettier, rustfmt, golangci-lint, SwiftLint
- **Tool configs** — Semgrep, commitlint, dependency-cruiser, mutation testing
- **`.cursor/rules/`** — Cursor IDE rules split by skill category
- **`.codex/hooks.json`** and **`.opencode/plugins/`** — hooks for other AI tools

The core philosophy: mechanical enforcement (hooks, linters) handles ~80% of rules. The remaining 20% — things that require judgment — lives in markdown docs that AI agents and humans both read.

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

Interactive setup for an existing project. Run inside a directory with `package.json`, `Cargo.toml`, `go.mod`, or `Package.swift` — scaffolding a new project is out of scope.

**Steps:**

1. **Detect** — Reads existing `package.json`, `Cargo.toml`, `go.mod`, or `Package.swift` to infer the project language and type. Exits with an error if none is present.

2. **Project type** — Selects from 15 variants across 4 languages:
   - TypeScript: `ts-frontend`, `ts-backend`, `ts-fullstack`, `ts-lib`, `ts-cli`, `ts-monorepo`
   - Rust: `rust-bin`, `rust-lib`, `rust-workspace`
   - Go: `go-bin`, `go-lib`, `go-workspace`
   - Swift: `swift-app`, `swift-lib`, `swift-package`

3. **Framework** — Context-sensitive list (React, Vue, Svelte, SvelteKit, Nuxt, Next.js, Remix, Hono, Express, Fastify, NestJS, SwiftUI, UIKit, etc.)

4. **Build commands** — Dev, build, test, typecheck, lint, format — auto-detected from `package.json` scripts, editable

5. **Rule skills** — Categories of coding standards to embed in AI instructions:
   - Code quality & strictness
   - Architecture (deep modules, layer boundaries, file size limits)
   - Testing (TDD, property-based testing, proof-of-work)
   - AI behavior (verify before claiming, no completion without proof)
   - Component patterns (frontend)
   - State management (frontend)
   - Styling & UI (frontend)
   - Performance

6. **Superpower skills** — Project-local copies of slash commands from `~/.agents/skills/`: debug, code-review, architecture, system-design, testing-strategy, tech-debt, deploy-checklist, documentation, write-spec, sprint-planning, incident-response, and more

7. **Tools** — Beads (issue tracker), contract-driven modules

8. **Workflow** — IDD (Intent-Driven Development), GSD (Get Shit Done), or lightweight spec-driven flow

9. **AI targets** — Which tools to generate config for: Claude Code, Codex, OpenCode, Cursor, lefthook

10. **MCP servers** — Memory, Serena (codebase indexing), GitHub

11. **Model routing** — Assigns Claude models to task types: planning, simple edits, review, default

### `oisin-dev update`

Re-syncs all generated files from `.dev.config.json` without re-prompting. Safe to run after pulling changes to the generator — it preserves your manual edits in `CLAUDE.md` (within managed blocks) and merges rather than overwrites `settings.json`.

```sh
oisin-dev update
```

## Generated files

### Claude Code (`.claude/`)

**Hooks** (`post-tool-use`, `pre-tool-use`, `stop`, `notification`):

| Hook | Purpose |
|---|---|
| `context-bootstrap.sh` | Injects project context at session start |
| `context-injector.sh` | Injects `.dev.config.json` on each prompt |
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

**Docs** (`.claude/docs/`):
- `commands.md` — build/test commands for this project
- `workflow.md` — selected workflow methodology
- `principles.md` — selected rule skills
- `uncertainty.md` — hallucination prevention rules
- `destructive.md` — destructive command policy
- `beads.md` — issue tracker instructions (if enabled)
- `contract-driven.md` — module contract pattern (if enabled)

**Skills** (`.claude/skills/`):
Local copies of selected superpower skills, available as slash commands within the project.

### CLAUDE.md / AGENTS.md

AI agent instruction file, kept under 200 lines at the root. Imports fragments via `@path/to/fragment` references. On `update`, only the managed block (between `<!-- BEGIN @oisincoveney/dev -->` and `<!-- END @oisincoveney/dev -->`) is rewritten — content you add outside the block is preserved.

### Lint and format configs

Generated with sensible defaults for each language. Existing configs are backed up to `.dev-backup` before overwriting.

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

All settings are stored in `.dev.config.json` at the project root:

```json
{
  "language": "typescript",
  "variant": "ts-fullstack",
  "framework": "Next.js",
  "packageManager": "bun",
  "commands": {
    "dev": "bun dev",
    "build": "bun build",
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "format": "prettier --write ."
  },
  "skills": ["code-quality", "architecture", "testing", "ai-behavior", "debug", "code-review"],
  "tools": ["beads"],
  "workflow": "gsd",
  "contractDriven": false,
  "targets": ["claude", "lefthook"],
  "models": {
    "default": "claude-sonnet-4-6",
    "planning": "claude-opus-4-6",
    "simple_edits": "claude-haiku-4-5-20251001",
    "review": "claude-sonnet-4-6"
  }
}
```

Edit this file manually or re-run `oisin-dev update` after changes.

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

This repo's tests run against real binaries — they don't mock `bd` or skip when it's missing. Install via [mise](https://mise.jdx.dev/) (preferred):

```sh
mise install   # reads .mise.toml — installs bun + beads (`bd`)
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
