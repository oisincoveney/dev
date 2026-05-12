---
name: scope-discipline
description: How the agent tracks scope expansion during work — file a discovered-from child ticket instead of silently editing files outside the claimed ticket's Files Likely Touched.
---

# Scope Discipline

Current claim name what in scope. Outside = separate ticket, not silent work.

## Rule

Mid-work on claim, discover fix touch file outside ticket's `## Files Likely Touched`:

1. Stop.
2. File discovered-from child via `bd create`:
   ```bash
   bd create --type=task --priority=2 --deps "discovered-from:<current-id>" \
     --title="<one-line description>" \
     --silent --body-file=- <<'EOF'
   ---
   type: task
   priority: 2
   files:
     - <out-of-scope file>
   verify:
     - <cmd>
   deps:
     discovered_from: <current-id>
   ac:
     - "WHEN ... THE SYSTEM SHALL ..."
   ---
   Found during <current-id>. Fix <issue> in <file>. Verify <cmd>.
   EOF
   ```
3. Stay scoped. Edit only originally-claimed files.
4. New ticket lands in `bd ready` as followup.

## Out of scope

- Edit file not in `Files Likely Touched`.
- Refactor nearby "would be nice" code.
- Fix unrelated bug noticed in passing.
- Test code outside ticket intent.
- Delete obsolete file ticket didn't name.

## Not out of scope (no ticket needed)

- Test files (`*.test.*`, `*.spec.*`, `__tests__/`) for in-scope code.
- Config (`.gitignore`, `package.json` deps) required by in-scope work.
- Docs (`README.md`, comments) reflecting in-scope change.
- Files Likely Touched small inference — ticket says "src/auth/", `src/auth/middleware.ts` still in scope.

Doubt → file ticket. Overcount = one extra issue. Undercount = silent scope creep.

## Why no mechanical block

Pre-edit blocking on scope violations require parsing issue body + comparing file path. Too many false positives, too brittle. Instead:

- This rule = soft commit.
- Audit post-check (`bun run scripts/check-scope-drift.ts`) catch after fact: parse `.claude/audit.jsonl`, find Edit/Write outside active ticket's Files Likely Touched. Run periodically.

## `/discover` slash command

If project ships `/discover <description>`, agent invoke that — wraps `bd create --deps=discovered-from`. Both paths equivalent.

## Hard rules

- Never silently fix outside claim scope.
- Never expand current ticket scope by editing body to add files. Claim locked at claim time.
- Always file discovered-from BEFORE out-of-scope edit, not after.

## See also

- `tracker-workflow.md` — tracker JSON plan, approval, graph, and PR grouping policy
- `tracer-bullet.md` — what counts as the graph's proof ticket
