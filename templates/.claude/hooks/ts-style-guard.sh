#!/usr/bin/env bash
# PreToolUse hook for Write|Edit — checks TS/TSX style rules
# Exit 0 = allow, Exit 2 = hard block
#
# Receives JSON on stdin from Claude Code with tool_input containing
# file_path and content/new_string.

set -euo pipefail

INPUT=$(cat)

FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.filePath // empty' 2>/dev/null)

if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

case "$FILE_PATH" in
  *.ts|*.tsx) ;;
  *) exit 0 ;;
esac

# Run the installed @oisin/style rule engine
if command -v bunx &>/dev/null; then
  echo "$INPUT" | bunx oisin-style check
elif command -v npx &>/dev/null; then
  echo "$INPUT" | npx oisin-style check
else
  echo "Style guard: neither bunx nor npx available" >&2
  exit 0
fi
