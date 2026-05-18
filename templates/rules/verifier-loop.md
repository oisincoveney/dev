---
name: verifier-loop
description: Fresh-context verification for Backlog-backed work before a task is closed.
---

# Verifier Loop

Before marking a Backlog task Done, invoke a fresh-context verifier subagent to confirm the work meets acceptance criteria. The main agent does not self-certify.

## Verifier Prompt Must Include

1. Backlog task ID being verified.
2. Instruction to re-read `backlog task view <id> --plain`.
3. Diff-aware skill loading rules.
4. Verification command list.
5. Forbidden actions: no source edits and no tracker status changes.

## Skill Loading

| Trigger | Skill |
|---|---|
| Always | `code-review` |
| Cross-boundary or multi-layer change | `architecture` |
| Test strategy changed | `testing-strategy` |
| Auth, input, secrets, parsing | security review skill when available |
| UI or frontend changed | `accessibility` |
| Hot path changed | `performance` |

## Output

```md
## Result: PASS | PASS-WITH-FOLLOWUPS | PARTIAL | FAIL

### Per-Criterion
- <criterion> - PASS|FAIL - <evidence file:line>

### Verification Commands
- `<cmd>` - exit <N> - <summary>

### Scope Check
- In scope: yes|no

### Follow-Up Tasks
- <id> - <title> - <reason>
```

## Result Rules

- `PASS`: all criteria pass, all verification commands pass, no out-of-scope issues.
- `PASS-WITH-FOLLOWUPS`: original criteria pass, but follow-up tasks were filed for separate work.
- `PARTIAL`: some required criteria are incomplete or unverified.
- `FAIL`: any required criterion fails or any verification command fails.

## Follow-Up Tasks

Use Backlog for discovered work:

```sh
backlog task create "<concise title>" \
  --description "Found while verifying <current-id>. <problem and expected fix>" \
  --priority medium \
  --dep <current-id> \
  --ac "WHEN ... THE SYSTEM SHALL ..."
```

## Main-Agent Action

| Result | Action |
|---|---|
| `PASS` | Set task Done with final summary and verification evidence. |
| `PASS-WITH-FOLLOWUPS` | Set task Done, include follow-up IDs in final summary. |
| `PARTIAL` | Keep task open, append verifier output to notes, fix, verify again. |
| `FAIL` | Keep task open, append failure evidence, fix, verify again. |

## Hard Rules

- Main agent never closes a task without verifier PASS or PASS-WITH-FOLLOWUPS.
- Outside-scope issues become Backlog follow-up tasks.
- Final summary must name the verification commands that passed.
