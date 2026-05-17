#!/usr/bin/env bash
# Single PreToolUse entry point. Dispatches to the relevant policy hooks based
# on tool_name so the agent UI shows one PreToolUse hook instead of one per
# matcher group.
set -uo pipefail

INPUT=$(cat)
TOOL_NAME=$(printf '%s' "$INPUT" | jq -r '.tool_name // .toolName // empty' 2>/dev/null || true)
TOOL_KEY=$(
  printf '%s' "$TOOL_NAME" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^[:alnum:]_]+/_/g; s/^_+//; s/_+$//'
)

HOOK_DIR=".claude/hooks"
case "$0" in
  .codex/*|*/.codex/*) HOOK_DIR=".codex/hooks" ;;
esac

SCRIPTS=("$HOOK_DIR/audit-log.sh")

case "$TOOL_KEY" in
  read|glob|grep|*_read|*_glob|*_grep)
    SCRIPTS+=("$HOOK_DIR/docs-first.sh")
    ;;
  todowrite|todo_write|todo|*_todowrite|*_todo_write|*_todo)
    SCRIPTS+=("$HOOK_DIR/block-todowrite.sh")
    ;;
  write|edit|multiedit|multi_edit|patch|apply_patch|*_write|*_edit|*_multiedit|*_multi_edit|*_patch|*_apply_patch)
    SCRIPTS+=(
      "$HOOK_DIR/worktree-write-guard.sh"
    )
    if [[ "${OISIN_DEV_TYPESCRIPT:-}" == "1" ]]; then
      SCRIPTS+=("$HOOK_DIR/ts-style-guard.sh" "$HOOK_DIR/import-validator.sh")
    fi
    SCRIPTS+=("$HOOK_DIR/ai-antipattern-guard.sh")
    ;;
  bash|shell|exec|exec_command|*_bash|*_shell|*_exec|*_exec_command)
    SCRIPTS+=(
      "$HOOK_DIR/destructive-command-guard.sh"
      "$HOOK_DIR/git-spice-command-guard.sh"
    )
    SCRIPTS+=("$HOOK_DIR/block-coauthor.sh")
    ;;
esac

printf '%s' "$INPUT" | "$HOOK_DIR/run-quiet.sh" "${SCRIPTS[@]}"
