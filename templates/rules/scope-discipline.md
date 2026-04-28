---
name: scope-discipline
description: How the agent tracks scope expansion during work — file a discovered-from child ticket instead of silently editing files outside the claimed ticket's Files Likely Touched.
---

# Scope Discipline

The current claim names what's in scope. Anything outside is **not** silent additional work — it's a separate ticket.

## The rule

When the agent is mid-work on a claimed ticket and discovers that a fix or change requires touching a file **outside** the ticket's `## Files Likely Touched` list:

1. Stop.
2. File a discovered-from child ticket via `bd create`:
   ```bash
   bd create --type=task --priority=2 --deps "discovered-from:<current-id>" \
     --title="<one-line description of the discovery>" \
     --silent --body-file=- <<'EOF'
   ## User story
   As a developer working on <current-id>, I discovered that <issue> needs to be addressed in <file>.

   ## Acceptance Criteria
   1. WHEN ... THE SYSTEM SHALL ...

   ## Files Likely Touched
   - <out-of-scope file> — <reason>

   ## Verification Commands
   - <cmd>

   ## Discovered-from
   Surfaced during work on <current-id>: <one-paragraph context>.
   EOF
   ```
3. Stay scoped. Continue working only on the originally-claimed ticket's files.
4. The new ticket appears in `bd ready` as a follow-up.

## What counts as "out of scope"

- Editing a file not in the current ticket's `Files Likely Touched`.
- Refactoring nearby code that "would be nice."
- Fixing an unrelated bug noticed in passing.
- Adding tests for code that was outside the ticket's intent.
- Deleting an obsolete file the ticket didn't say to delete.

## What does NOT need a discovered-from ticket

- Test files (`*.test.*`, `*.spec.*`, `__tests__/`) for the in-scope code.
- Config files (`.gitignore`, `package.json` deps) when the in-scope work requires it.
- Docs (`README.md`, comments) updated to reflect the in-scope change.
- Files Likely Touched expansion via small inference — if the ticket says "src/auth/" and you find `src/auth/middleware.ts`, that's still in scope.

When in doubt, file the discovered-from ticket. The cost of overcounting is one extra issue; the cost of undercounting is silent scope creep.

## Why mechanical enforcement is hard (and why this rule matters)

Pre-edit blocking on scope violations would require parsing the issue body and comparing against the file path being edited. We don't do that — too many false positives, too brittle. Instead:

- This rule is the soft commitment the agent should follow.
- The audit-log post-check (`bun run scripts/check-scope-drift.ts`) catches violations after the fact: parses `.claude/audit.jsonl`, finds Edit/Write events targeting files outside the active ticket's Files Likely Touched, and reports them. Run periodically.

## When `/discover` exists as a slash command

If the project ships a `/discover <description>` slash command, the agent invokes that for the same effect — it wraps the `bd create --deps=discovered-from` call. Both paths are equivalent; behavioral rule + slash command are different surfaces for the same intent.

## Hard rules

- Never silently fix something outside the claim's scope.
- Never expand the current ticket's scope by editing the issue body to add files. The claim is locked at claim time.
- Always file the discovered-from ticket BEFORE making the out-of-scope edit, not after.
