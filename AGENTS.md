<!-- BEGIN @oisincoveney/dev managed block -->
# Project Instructions for AI Agents

Configured with @oisincoveney/dev. Hooks enforce most rules mechanically. Detailed rules in `.claude/rules/` — Claude Code auto-loads (always for unscoped, on matching file read for path-scoped).

## Critical Rules (always active)

- Never run destructive commands without explicit user approval — blocked by hook.
- Read before editing; verify before claiming done.
- Confident wrong > honest uncertain — false. Say "I need to verify", check.
- User constraints non-negotiable. Don't reinterpret.
- No follow-up questions like "Want me to...". Done → stop.
- When called out, skip chummy acknowledgments like "fair point" or "you're right"; research, verify, or fix.
- Don't write "this works"/"should work"/"done" without running test cmd + seeing pass. Stop hook enforces.
- One non-trivial question at a time. Stacking judgment-call questions = not OK.

## Detailed Rules

See `.claude/rules/` for full set. Topic files (`architecture.md`, `testing.md`, `ai-behavior.md`, etc.) load every session. Path-scoped (`component-patterns.md`, `styling-ui.md`, `contract-driven.md`) load only on matching file read — editing `.tsx` pulls frontend rules automatically.

<!-- END @oisincoveney/dev managed block -->

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
oisin-dev tracker show <id>     # View normalized tracker item
oisin-dev tracker approve <id>  # Approve reviewed tracker plan
bd ready                        # Find available beads work
bd show <id>                    # View raw beads issue details
```

### Rules

- Use the tracker workflow for planned work. Beads is the first adapter, and `metadata.workflow` JSON is canonical.
- Main thread is always orchestrator. All implementation, including quick work, runs in agent worktrees.
- `/quick [P2|P3] <task>` is the only low-ceremony lane. It still uses an agent worktree, verification, commit, and merge-back.
- `/plan` creates tracker-backed review items; `/approve` moves approved plans to ready; `/work-next` dispatches ready work.
- Use `bd` for tracker storage — do NOT use TodoWrite, TaskCreate, or markdown TODO lists as source of truth.
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files
- Agents may normal-push or force-push non-protected task/quick branches and may open PRs. Never push `main`, `master`, release branches, or tags without explicit authorization.
<!-- END BEADS INTEGRATION -->
