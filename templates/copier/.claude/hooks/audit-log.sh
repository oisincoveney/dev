#!/usr/bin/env bash
# PreToolUse hook on all tools — appends one JSON line per tool call to
# .claude/audit.jsonl for retroactive review of agent behavior.
#
# Always exits 0 (never blocks). Failures (jq missing, no write perms)
# silently no-op so the agent flow is never interrupted.
set -uo pipefail

INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // "."' 2>/dev/null || echo ".")

LOG_DIR="$CWD/.claude"
LOG_FILE="$LOG_DIR/audit.jsonl"

mkdir -p "$LOG_DIR" 2>/dev/null || exit 0

LINE=$(jq -c '{ts: now, sessionId: (.session_id // .sessionId // null), tool: (.tool_name // .toolName // null), input: (.tool_input // .toolInput // null)}' <<<"$INPUT" 2>/dev/null || echo "")

if [[ -n "$LINE" ]]; then
  printf '%s\n' "$LINE" >>"$LOG_FILE" 2>/dev/null || true
fi

exit 0
