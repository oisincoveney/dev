#!/usr/bin/env bash
# Single PreToolUse entry point. Dispatches to the relevant policy hooks based
# on tool_name so the agent UI shows one PreToolUse hook instead of one per
# matcher group.
set -uo pipefail

INPUT=$(cat)
TOOL_NAME=$(printf '%s' "$INPUT" | jq -r '.tool_name // .toolName // empty' 2>/dev/null || true)

HOOK_DIR=".claude/hooks"
case "$0" in
  .codex/*|*/.codex/*) HOOK_DIR=".codex/hooks" ;;
esac

SCRIPTS=("$HOOK_DIR/audit-log.sh")

case "$TOOL_NAME" in
  Read|Glob)
    SCRIPTS+=("$HOOK_DIR/docs-first.sh")
    ;;
  Write|Edit)
    SCRIPTS+=(
      "$HOOK_DIR/worktree-write-guard.sh"
    )
    if [[ "${OISIN_DEV_BEADS:-}" == "1" ]]; then
      SCRIPTS+=("$HOOK_DIR/require-claim.sh" "$HOOK_DIR/require-swarm.sh")
    fi
    if [[ "${OISIN_DEV_TYPESCRIPT:-}" == "1" ]]; then
      SCRIPTS+=("$HOOK_DIR/ts-style-guard.sh" "$HOOK_DIR/import-validator.sh")
    fi
    SCRIPTS+=("$HOOK_DIR/ai-antipattern-guard.sh")
    ;;
  Bash)
    SCRIPTS+=(
      "$HOOK_DIR/destructive-command-guard.sh"
    )
    if [[ "${OISIN_DEV_BEADS:-}" == "1" ]]; then
      SCRIPTS+=(
        "$HOOK_DIR/bd-remember-protect.sh"
        "$HOOK_DIR/plan-approval-guard.sh"
        "$HOOK_DIR/bd-create-gate.sh"
      )
    fi
    SCRIPTS+=("$HOOK_DIR/block-coauthor.sh")
    ;;
  TodoWrite|todo_write|todowrite)
    SCRIPTS+=("$HOOK_DIR/block-todowrite.sh")
    ;;
esac

printf '%s' "$INPUT" | "$HOOK_DIR/run-quiet.sh" "${SCRIPTS[@]}"
