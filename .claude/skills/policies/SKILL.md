---
name: policies
description: Full policy reference — destructive commands, verification rituals, commit hygiene, git safety. Invoke when the user asks about project policy, when you're about to run a destructive command, when committing code, or when you need the verification protocol for external APIs.
user-invocable: false
---

# Project Policies

Claude: invoke this skill when a turn touches any of the below. The short-form kernel lives in CLAUDE.md; the full detail is here.

## Destructive Operations

Blocked by hook. Never attempt without explicit user approval:

- `git reset --hard`
- `git push --force` / `git push -f`
- `git clean -f`
- `rm -rf`
- `DROP TABLE` / `DROP DATABASE`
- `npm publish` / `yarn publish` / `bun publish` / `pnpm publish`

If the user has explicitly authorized a destructive operation, ask again before each occurrence — authorization does not persist across the session.

## Commit Hygiene

- **Never add a `Co-Authored-By: Claude` trailer.** Stripped automatically by `block-coauthor.sh`.
- Commit messages start with a conventional-commit prefix (`feat:`, `fix:`, `chore:`, `docs:`, etc.). Breaking changes use `feat!:` / `fix!:` or a `BREAKING CHANGE:` footer.
- One logical change per commit. If you touched unrelated files to fix lint, split the commit.
- Reference the spec in non-trivial commits: "Implements per specs/YYYY-MM-DD-<slug>.md".

## Verification Protocol (external APIs, libraries, package features)

When you're about to write code that uses something you haven't verified in THIS session, you MUST:

1. Say explicitly: "I need to verify <X>"
2. Use Read/Grep/Glob to check the actual source or installed package
3. If confirmed, proceed; if not, ask the user or use the actually-available API
4. Never state an API exists based on training data alone

**Specific forbidden patterns:**

- Writing `import { foo } from 'pkg'` without verifying `foo` is exported by `pkg` (the `import-validator.sh` hook will block fabricated imports)
- Calling `lib.method()` without confirming the method exists in the installed version
- Referencing filesystem paths, env vars, or config keys without reading the actual file
- Citing documentation claims without having read the docs in this session
- Saying "this works", "this should work", "I believe this is correct", or "the tests should pass" as a terminal statement without having run the test command and seen passing output

## Completion Claims

Never write "this works", "this should work", "tests should pass", or "done" as a terminal statement without:

1. Running the configured `test` command (see `.claude/rules/commands.md` or `.dev.config.json`)
2. Observing passing output
3. Including that output in your response

The `pre-stop-verification.sh` hook inspects the session transcript — it blocks turns that claim completion without evidence.

## Git Safety

- Prefer `git push --force-with-lease` over `--force` if a force-push is ever explicitly authorized.
- Never force-push to `main` / `master` without the user explicitly naming the branch.
- Investigate unexpected files, branches, or lock files before deleting or overwriting them — they may be the user's in-progress work.
- Merge conflicts: resolve, don't discard.
