#!/usr/bin/env bash
# PreToolUse hook for TodoWrite — blocks it and redirects to beads.
set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // .toolName // empty' 2>/dev/null || true)
HAS_TOOL_INPUT=$(echo "$INPUT" | jq -r 'has("tool_input") or has("toolInput")' 2>/dev/null || echo "false")

case "$TOOL_NAME" in
  TodoWrite|todo_write|todowrite) ;;
  "")
    [[ "$HAS_TOOL_INPUT" != "true" ]] && exit 0
    ;;
  *) exit 0 ;;
esac

echo "⛔ TodoWrite is blocked. Use beads instead:" >&2
echo "" >&2
echo "   bd create <title>     — create an issue" >&2
echo "   bd update <id>        — update an issue" >&2
echo "   bd ready              — find available work" >&2
echo "   bd show <id>          — view issue details" >&2
echo "   bd close <id>         — complete work" >&2
echo "" >&2
echo "Run 'bd prime' for the full workflow reference." >&2
exit 2
