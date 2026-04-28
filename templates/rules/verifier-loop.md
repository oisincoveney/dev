---
name: verifier-loop
description: How the agent verifies its own ticket work via a fresh-context subagent that uses the code-review skill, files new bd tickets for discovered issues, and self-extends the work via PASS-WITH-FOLLOWUPS.
---

# Verifier Loop

Before `bd close`, the agent invokes a fresh-context **verifier subagent** to confirm the work meets the ticket's acceptance criteria. The verifier uses the `code-review` skill plus a diff-aware selection of additional skills, and any issues it finds outside the original AC become **new bd tickets** — not silent inline fixes.

## When to invoke

Always, before `bd close`. Not optional. The main agent does not self-certify completion.

## How to invoke

Spawn an Agent with `subagent_type=general-purpose` and a self-contained prompt that includes:

1. The bd issue ID being verified.
2. Instructions to re-read `bd show <id>` from scratch.
3. The skill-loading protocol (see below).
4. The output format (see below).
5. Explicit forbidden actions (no `bd close`, no `bd update`, no source edits).

## Skill loading protocol (verifier picks based on the diff)

| Trigger | Skill |
|---|---|
| Always | `code-review` |
| Always | `tech-debt` |
| Multi-layer / cross-boundary changes | `architecture` |
| Test surfaces touched | `testing-strategy` |
| Auth, input handling, secrets, parsing | `security-review` |
| UI / frontend code touched | `accessibility` |
| Hot-path code (renders, request handlers, loops) | `performance` |

The verifier inspects `git diff` to decide which apply. It loads them via the `Skill` tool.

## Output format (structured)

The verifier returns:

```
## Result: PASS | PASS-WITH-FOLLOWUPS | PARTIAL | FAIL

### Per-criterion (against the EARS acceptance criteria)
1. <criterion text> — PASS — <evidence with file:line>
2. <criterion text> — FAIL — <evidence>
...

### Verification commands
- `<cmd>` — exit <N> — <one-line summary>

### Scope check
- Edits stayed within `Files Likely Touched`: yes | no (list out-of-scope files)

### New tickets filed (for issues outside the original AC)
- bd-XXX.YY — <title> — <reason>
- ...
```

**Aggregate rules:**

- **PASS** — every criterion PASS, every verification command exited 0, scope respected, **zero new tickets filed**.
- **PASS-WITH-FOLLOWUPS** — every criterion PASS for the original AC, but the verifier filed N new tickets for issues outside scope. The current ticket is shippable; the followups are next-up work.
- **PARTIAL** — some criteria PASS but at least one FAIL or only partially satisfied.
- **FAIL** — at least one criterion clearly unsatisfied OR a verification command exited non-zero.

## Filing new tickets (the self-repeating loop)

For any issue the verifier finds that is NOT in the original AC:

```bash
bd create --type=task --priority=N --deps "discovered-from:<current-id>" \
  --title="<concise issue summary>" --silent --body-file=- <<'EOF'
## User story
As <role> I want <fix> so that <benefit>.

## Acceptance Criteria
1. WHEN ... THE SYSTEM SHALL ...

## Files Likely Touched
- <path> — <reason>

## Verification Commands
- <cmd>

## Discovered-from
Found during verification of <current-id> by the verifier subagent.
EOF
```

These appear in `bd ready` and become the next-up work.

## Main-agent behavior on result

| Result | Action |
|---|---|
| **PASS** | `bd close <id> --reason "verified clean by /verify-spec"`. Then `bd ready` → claim next. |
| **PASS-WITH-FOLLOWUPS** | `bd close <id> --reason "verified; filed N followups"`. The followups appear in `bd ready` next; the agent claims them automatically (continuing the loop) or surfaces them to the user. |
| **PARTIAL** | DO NOT close. Append the verifier output as `bd note <id>`. Fix the failing items in-place. Re-invoke verifier. Repeat until PASS or PASS-WITH-FOLLOWUPS. |
| **FAIL** | Same as PARTIAL — DO NOT close, fix, re-verify. |

## Loop termination

The loop stops when the verifier returns **clean PASS with zero new tickets** AND the bd ready queue (or the parent epic's ready queue) is empty. Until then, the main agent keeps claiming next-ups.

## Hard rules

- **No self-verification.** The main agent NEVER decides on its own that the ticket is done. The verifier subagent is the only authority for `bd close`.
- **No silent inline fixes.** If the verifier finds something outside the original AC, it files a ticket. It does NOT edit the code to "just fix it real quick."
- **No `bd close` until PASS or PASS-WITH-FOLLOWUPS.** PARTIAL/FAIL means more work, not a softened close.
