#!/usr/bin/env bash
# PostToolUse hook for Write|Edit — runs typecheck + lint after TS/Rust/Go edits.
# Reads commands from .dev.config.json at the project root.
# Exit 0 = allow, Exit 2 = hard block.
set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.filePath // empty' 2>/dev/null)
if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

case "$FILE_PATH" in
  *.ts|*.tsx|*.rs|*.go) ;;
  *) exit 0 ;;
esac

CONFIG_FILE=".dev.config.json"
if [[ ! -f "$CONFIG_FILE" ]]; then
  exit 0
fi

TYPECHECK_CMD=$(jq -r '.commands.typecheck // empty' "$CONFIG_FILE")
LINT_CMD=$(jq -r '.commands.lint // empty' "$CONFIG_FILE")

errors=""

if [[ -n "$TYPECHECK_CMD" ]]; then
  tc_out=$(bash -c "$TYPECHECK_CMD" 2>&1 || true)
  file_errors=$(echo "$tc_out" | grep -F "$FILE_PATH" | head -10 || true)
  if [[ -n "$file_errors" ]]; then
    errors+="Typecheck errors in $FILE_PATH:\n$file_errors\n\n"
  fi
fi

if [[ -n "$LINT_CMD" ]]; then
  lint_out=$(bash -c "$LINT_CMD" 2>&1 || true)
  file_errors=$(echo "$lint_out" | grep -F "$FILE_PATH" | head -10 || true)
  if [[ -n "$file_errors" ]]; then
    errors+="Lint errors in $FILE_PATH:\n$file_errors\n"
  fi
fi

if [[ -n "$errors" ]]; then
  echo -e "$errors" >&2
  echo "Fix the errors above before continuing." >&2
  exit 2
fi

exit 0
