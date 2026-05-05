---
name: policies
description: Full policy reference — destructive commands, verification rituals, commit hygiene, git safety. Invoke when the user asks about project policy, when you're about to run a destructive command, when committing code, or when you need the verification protocol for external APIs.
user-invocable: false
---

# Project Policies

Claude: invoke when turn touches any below. Short-form kernel in CLAUDE.md; full detail here.

## Destructive Operations

Blocked by hook. Never attempt without explicit user approval:

- `git reset --hard`
- `git push --force` / `git push -f`
- `git clean -f`
- `rm -rf`
- `DROP TABLE` / `DROP DATABASE`
- `npm publish` / `yarn publish` / `bun publish` / `pnpm publish`

User explicitly authorized destructive op → ask again each occurrence. Auth doesn't persist across session.

## Commit Hygiene

- **Never add `Co-Authored-By: Claude` trailer.** `block-coauthor.sh` strips automatically.
- Commits start with conventional-commit prefix (`feat:`, `fix:`, `chore:`, `docs:`, etc.). Breaking changes use `feat!:` / `fix!:` or `BREAKING CHANGE:` footer.
- One logical change per commit. Unrelated lint files touched → split.
- Non-trivial commits reference spec: "Implements per specs/YYYY-MM-DD-<slug>.md".

## Verification Protocol (external APIs, libs, package features)

Before writing code using anything not verified THIS session:

1. Say: "I need to verify <X>"
2. Read/Grep/Glob actual source or installed package.
3. Confirmed → proceed. Else ask user or use actually-available API.
4. Never claim API exists from training alone.

**Forbidden patterns:**

- `import { foo } from 'pkg'` without verifying `foo` exported by `pkg` (`import-validator.sh` blocks).
- `lib.method()` without confirming method exists in installed version.
- Filesystem paths, env vars, config keys without reading actual file.
- Citing docs claims without reading docs this session.
- Saying "this works"/"should work"/"believe correct"/"tests should pass" as terminal without running test + seeing pass.

## Completion Claims

Never write "this works"/"should work"/"tests should pass"/"done" as terminal without:

1. Running configured `test` cmd (see `.claude/rules/commands.md` or `.dev.config.json`).
2. Observing passing output.
3. Including output in response.

`pre-stop-verification.sh` hook inspects session transcript — blocks turns claiming completion without evidence.

## Git Safety

- **Committing always fine.** Local commits — ticket branch, worktree, directly on `main`/`master` — no user approval. Commits reversible, local until pushed, unit of work agent produces.
- **Pushing scoped.** Ticket branch or `.claude/worktrees/*` worktree → agent pushes own work without asking — that's the sandbox. Pushing `main`/`master` (or other shared/long-lived branch) → explicit user approval each time.
- Prefer `git push --force-with-lease` over `--force` if force-push explicitly authorized. Force-push always needs explicit per-branch approval — auth on one branch doesn't carry to another.
- Never force-push to `main`/`master` without user explicitly naming the branch.
- Never open or merge PR without explicit user approval. Merging = user's call.
- Investigate unexpected files, branches, lock files before delete/overwrite — may be user's in-progress work.
- Merge conflicts: resolve, don't discard.
