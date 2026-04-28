---
name: to-bd-issues
description: Break a plan, spec, or grilled conversation into independently-grabbable bd issues (epic + child tasks) using tracer-bullet vertical slices. Use when user has finished planning (often via grill-me) and wants to convert the design into bd tickets.
---

<!--
Forked from https://github.com/mattpocock/skills/tree/main/skills/to-issues
(MIT, Copyright (c) 2026 Matt Pocock). Adapted to write bd issues
via `bd create --graph` instead of GitHub issues via `gh`. See LICENSE
in this directory for the full notice.
-->

# To bd Issues

Break a plan into independently-grabbable **bd issues** using vertical slices (tracer bullets).

## Process

### 1. Gather context

Work from whatever is already in the conversation context — usually the result of a `grill-me` session, or a draft the user pasted. Do not make up requirements; if the design tree has gaps, halt and ask.

### 2. Refuse on unresolved clarifications

If the conversation contains any `[NEEDS CLARIFICATION: ...]` markers, **do not write to bd**. Surface the markers to the user and request resolution first. The discipline is: bd issues encode resolved decisions, not open questions.

### 3. Explore the codebase (when relevant)

If a slice's shape depends on existing code (file paths, current API surfaces, conventions), inspect the codebase before writing the issue body. Cite `file:line` in the issue's `## Files Likely Touched` section.

### 4. Draft vertical slices

Break the plan into **tracer bullet** issues. Each issue is a thin vertical slice that cuts through ALL integration layers end-to-end, NOT a horizontal slice of one layer.

Slices may be 'HITL' or 'AFK'. HITL slices require human interaction (an architectural decision, a design review, a credential). AFK slices can be implemented and verified without human interaction. Prefer AFK over HITL where possible.

<vertical-slice-rules>
- Each slice delivers a narrow but COMPLETE path through every layer (schema, business logic, surface, tests).
- A completed slice is demoable or verifiable on its own.
- Prefer many thin slices over few thick ones.
- Slice the dependency edges so the DAG has multiple ready fronts (parallel-friendly).
</vertical-slice-rules>

### 5. Show the breakdown to the user

Present the proposed graph as a numbered list. For each slice, show:

- **Title**: short descriptive name (will become the issue title).
- **Type**: HITL / AFK.
- **Blocked by**: which slice keys must close first (use temporary keys like `a`, `b`, `c` until bd assigns IDs).
- **EARS acceptance criteria**: 1–3 numbered EARS criteria.
- **Files Likely Touched**: with one-line reasons.

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Are the dependency edges correct?
- Should any slices merge or split further?
- HITL vs AFK marked correctly?

Iterate until the user approves the breakdown.

### 6. Create the epic and the child issues atomically

Use `bd create --graph` to create the entire DAG in one call. The graph format:

```bash
bd create --graph /dev/stdin <<'EOF'
{
  "nodes": [
    {"key": "epic", "title": "<epic title>", "type": "epic", "priority": 0,
     "description": "<EARS epic body — see template below>"},
    {"key": "a", "title": "<slice 1>", "type": "task", "parent": "epic",
     "description": "<EARS child body — see template below>"},
    {"key": "b", "title": "<slice 2>", "type": "task", "parent": "epic", "depends_on": ["a"],
     "description": "..."},
    ...
  ]
}
EOF
```

Capture the returned ID mappings (e.g., `epic -> bd-XYZ`, `a -> bd-XYZ.1`).

### 7. Validate

After creation:
- Run `bd lint <epic-id>` — must report zero warnings.
- Run `bd swarm validate <epic-id>` — confirms the DAG is acyclic and shows ready fronts.
- Run `bd swarm create <epic-id>` to register the swarm so subsequent `require-swarm.sh` PreToolUse checks pass.

Report the epic ID and the count of children to the user.

## Templates

### Epic body

```markdown
## User story
As a <role> I want <capability> so that <benefit>.

## Success Criteria
1. WHEN <event> THE SYSTEM SHALL <response>
2. IF <precondition> THEN THE SYSTEM SHALL <response>
3. WHILE <state>, WHEN <event> THE SYSTEM SHALL <response>

## Out of Scope
- <explicit non-goal>

## Constitution references
- <pinned bd decisions or rules this epic must respect>
```

### Child task body

```markdown
## User story
As a <role> I want <capability> so that <benefit>.

## Acceptance Criteria
1. WHEN <event> THE SYSTEM SHALL <response>
2. IF <precondition> THEN THE SYSTEM SHALL <response>

## Files Likely Touched
- <path> — <reason>
- <path>.test.ts — <reason>

## Verification Commands
- <cmd> — <one-line summary>

## Out of Scope
- <explicit non-goal>
```

## Forbidden actions

- Do NOT write any markdown file outside of bd's database — no `.claude/specs/`, no `docs/`, no temp drafts that linger after the run. The body lives in bd via stdin only.
- Do NOT call `bd update <id> --claim`. Claiming is the user's explicit action via `/work-next` or follow-up prompt.
- Do NOT modify any unrelated bd issue.
- Do NOT close the parent epic until all children close (handled automatically by `bd swarm close-eligible`).

## When NOT to invoke this skill

- Single-file, single-concern work — file as one `bd create --type=task` directly without epic ceremony.
- Pure-research that produces a memory rather than implementation work — use `bd remember` instead.
- Bug fixes contained to the work of an already-claimed ticket — use `discovered-from` on the current ticket via `/discover` or its rule.
