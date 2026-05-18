#!/usr/bin/env bash
# PreToolUse hook for TodoWrite — blocks it and redirects to Backlog.md.
set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // .toolName // empty' 2>/dev/null || true)
TOOL_KEY=$(
  printf '%s' "$TOOL_NAME" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^[:alnum:]_]+/_/g; s/^_+//; s/_+$//'
)
HAS_TOOL_INPUT=$(echo "$INPUT" | jq -r 'has("tool_input") or has("toolInput")' 2>/dev/null || echo "false")

case "$TOOL_KEY" in
  todowrite|todo_write|todo|*_todowrite|*_todo_write|*_todo) ;;
  "")
    [[ "$HAS_TOOL_INPUT" != "true" ]] && exit 0
    ;;
  *) exit 0 ;;
esac

echo "⛔ TodoWrite is blocked. Use Backlog.md instead:" >&2
echo "" >&2
echo "   backlog task create \"<title>\" --description \"<why>\" --ac \"<criterion>\"" >&2
echo "   backlog task list -s \"To Do\" --plain" >&2
echo "   backlog task view <id> --plain" >&2
echo "   backlog task edit <id> -s \"In Progress\"" >&2
echo "   backlog task edit <id> -s Done --final-summary \"<summary>\"" >&2
echo "" >&2
echo "Run 'backlog board' or 'backlog browser --no-open' for local visibility." >&2
exit 2
