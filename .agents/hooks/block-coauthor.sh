#!/usr/bin/env bash
# PreToolUse hook for Bash — blocks git commit commands that contain Co-Authored-By trailers.
set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
if [[ -z "$COMMAND" ]]; then
  exit 0
fi

# Only check git commit commands
if ! echo "$COMMAND" | grep -qE '^git[[:space:]]+commit'; then
  exit 0
fi

if echo "$COMMAND" | grep -qi 'Co-Authored-By:'; then
  echo "⛔ Co-Authored-By trailers are not allowed in this project." >&2
  echo "   Rewrite the commit message without the Co-Authored-By line." >&2
  exit 2
fi

exit 0
