---
name: verifier-loop
description: How the agent verifies its own ticket work via a fresh-context subagent that uses the code-review skill, files new Backlog tasks for discovered issues, and self-extends the work via PASS-WITH-FOLLOWUPS.
---

# Verifier Loop

Before marking a Backlog task Done, agent invoke fresh-context **verifier subagent** to confirm work meets ticket AC. Verifier use `code-review` + diff-aware extra skills. Issues outside original AC → **new Backlog tasks**, not silent inline fixes.

## When

Always, before marking a task Done. Not optional. Main agent never self-certify.

## How

Spawn Agent with `subagent_type=general-purpose`, self-contained prompt:

1. Backlog task ID being verified.
2. Re-read `backlog task view <id> --plain` from scratch.
3. Skill-loading protocol (below).
4. Output format (below).
5. Forbidden: no Backlog status changes, no task edits, no source edits.

## Skill loading (verifier picks per diff)

| Trigger | Skill |
|---|---|
| Always | `code-review` |
| Always | `tech-debt` |
| `.ts` / `.tsx` / `.js` / `.jsx` / `.mjs` / `.cjs` in diff | `typescript-advanced-types` |
| `.tsx` under `app/` or `pages/` (Next.js) | `nextjs-app-router-patterns`, `vercel-react-best-practices` |
| `.go` in diff | `golang-pro`, `golang-error-handling`, `golang-code-style` |
| `.py` in diff | language reviewer (load `code-review` only — no Python-specific skill ships with the harness yet) |
| Multi-layer / cross-boundary | `architecture` |
| Test surfaces touched | `testing-strategy` |
| Auth, input, secrets, parsing | `security-review` |
| UI / frontend touched | `accessibility` |
| Hot-path (renders, request handlers, loops) | `performance` |

Verifier inspect `git diff` to decide. Load via `Skill` tool. **Skill loading is not optional** — every row whose trigger matches the diff MUST be loaded. The `verifier-skill-guard.sh` Stop hook scans the transcript for these invocations and blocks completion claims / Backlog Done edits if they're missing.

## Output format

```
## Result: PASS | PASS-WITH-FOLLOWUPS | PARTIAL | FAIL

### Per-criterion (against EARS AC)
1. <criterion> — PASS — <evidence file:line>
2. <criterion> — FAIL — <evidence>
...

### Verification commands
- `<cmd>` — exit <N> — <one-line>

### Scope check
- Edits within `Files Likely Touched`: yes | no (list out-of-scope)

### New tickets filed (issues outside original AC)
- <task-id> — <title> — <reason>
- ...
```

**Aggregate rules:**

- **PASS** — every criterion PASS, every cmd exit 0, scope respected, **zero new tickets**.
- **PASS-WITH-FOLLOWUPS** — every criterion PASS for original AC, verifier filed N new tickets outside scope. Ticket shippable; followups next-up.
- **PARTIAL** — some criteria PASS but ≥1 FAIL or partial.
- **FAIL** — ≥1 criterion unsatisfied OR cmd exit ≠0.

## Filing new tickets (self-repeating loop)

Any issue NOT in original AC:

```bash
backlog task create "<concise summary>" \
  --priority medium \
  --depends-on "<current-id>" \
  --modified-file "<path>" \
  --ac "WHEN ... THE SYSTEM SHALL ..." \
  --notes "Found by verifier. Fix <problem>. Touch <path>. Verify <cmd>."
```

Appear in `backlog task list -s "To Do" --plain` as next-up after dependencies allow it.

## Main-agent action on result

| Result | Action |
|---|---|
| **PASS** | `backlog task edit <id> -s Done --final-summary "verified clean by /verify-spec"`. Then `backlog task list -s "To Do" --plain` → claim next. |
| **PASS-WITH-FOLLOWUPS** | Mark Done with final summary noting N followups. Followups remain in Backlog; agent claims auto or surfaces to user. |
| **PARTIAL** | DO NOT mark Done. Append verifier output as task notes. Fix failing items. Re-invoke verifier. Repeat until PASS / PASS-WITH-FOLLOWUPS. |
| **FAIL** | Same as PARTIAL — DO NOT close, fix, re-verify. |

## Loop termination

Stops when verifier returns **clean PASS, zero new tasks** AND the ready Backlog queue is empty. Else main agent keeps claiming.

## Hard rules

- **No self-verification.** Main agent NEVER decides ticket done. Verifier subagent is the only authority for marking a task Done.
- **No silent inline fixes.** Outside-AC issue → file ticket. Don't "just fix it real quick."
- **No Done status until PASS / PASS-WITH-FOLLOWUPS.** PARTIAL/FAIL = more work, not softened close.
