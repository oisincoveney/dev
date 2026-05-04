---
name: verifier-loop
description: How the agent verifies its own ticket work via a fresh-context subagent that uses the code-review skill, files new bd tickets for discovered issues, and self-extends the work via PASS-WITH-FOLLOWUPS.
---

# Verifier Loop

Before `bd close`, agent invoke fresh-context **verifier subagent** to confirm work meets ticket AC. Verifier use `code-review` + diff-aware extra skills. Issues outside original AC → **new bd tickets**, not silent inline fixes.

## When

Always, before `bd close`. Not optional. Main agent never self-certify.

## How

Spawn Agent with `subagent_type=general-purpose`, self-contained prompt:

1. bd issue ID being verified.
2. Re-read `bd show <id>` from scratch.
3. Skill-loading protocol (below).
4. Output format (below).
5. Forbidden: no `bd close`, no `bd update`, no source edits.

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

Verifier inspect `git diff` to decide. Load via `Skill` tool. **Skill loading is not optional** — every row whose trigger matches the diff MUST be loaded. The `verifier-skill-guard.sh` Stop hook scans the transcript for these invocations and blocks completion claims / `bd close` if they're missing.

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
- bd-XXX.YY — <title> — <reason>
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
bd create --type=task --priority=N --deps "discovered-from:<current-id>" \
  --title="<concise summary>" --silent --body-file=- <<'EOF'
## User story
As <role> I want <fix> so that <benefit>.

## Acceptance Criteria
1. WHEN ... THE SYSTEM SHALL ...

## Files Likely Touched
- <path> — <reason>

## Verification Commands
- <cmd>

## Discovered-from
Found during verification of <current-id> by verifier subagent.
EOF
```

Appear in `bd ready` as next-up.

## Main-agent action on result

| Result | Action |
|---|---|
| **PASS** | `bd close <id> --reason "verified clean by /verify-spec"`. Then `bd ready` → claim next. |
| **PASS-WITH-FOLLOWUPS** | `bd close <id> --reason "verified; filed N followups"`. Followups in `bd ready`; agent claims auto or surfaces to user. |
| **PARTIAL** | DO NOT close. Append verifier output as `bd note <id>`. Fix failing items. Re-invoke verifier. Repeat until PASS / PASS-WITH-FOLLOWUPS. |
| **FAIL** | Same as PARTIAL — DO NOT close, fix, re-verify. |

## Loop termination

Stops when verifier returns **clean PASS, zero new tickets** AND `bd ready` (or parent epic's queue) empty. Else main agent keeps claiming.

## Hard rules

- **No self-verification.** Main agent NEVER decides ticket done. Verifier subagent only authority for `bd close`.
- **No silent inline fixes.** Outside-AC issue → file ticket. Don't "just fix it real quick."
- **No `bd close` until PASS / PASS-WITH-FOLLOWUPS.** PARTIAL/FAIL = more work, not softened close.
