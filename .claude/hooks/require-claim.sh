#!/usr/bin/env bash
# PreToolUse hook for Write|Edit — blocks edits to source files unless
# a bd issue is currently in_progress (claimed). Forces "one ticket per
# unit of work" discipline at the harness level.
#
# Bypassed for test files, docs, .claude/, .beads/, and dependency
# directories. Fail-open if bd is not on PATH.
set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.filePath // empty' 2>/dev/null)

[[ -z "$FILE_PATH" ]] && exit 0

case "$FILE_PATH" in
  *.test.*|*.spec.*|*_test.go) exit 0 ;;
  */__tests__/*|*/tests/*) exit 0 ;;
  */node_modules/*|*/dist/*|*/build/*|*/target/*|*/.next/*|*/generated/*) exit 0 ;;
  */.claude/*|*/.beads/*|*/.cursor/*|*/.codex/*|*/.opencode/*) exit 0 ;;
  */.git/*|*/.github/*) exit 0 ;;
  *.md|*README*|*LICENSE*|*CHANGELOG*) exit 0 ;;
  *.json|*.yaml|*.yml|*.toml) exit 0 ;;
esac

case "$FILE_PATH" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.rs|*.go|*.swift|*.py|*.rb) ;;
  *) exit 0 ;;
esac

command -v bd >/dev/null 2>&1 || exit 0

IN_PROGRESS=$(bd list --status in_progress --json 2>/dev/null | jq -r 'length' 2>/dev/null || echo "0")

if [[ "$IN_PROGRESS" -gt 0 ]]; then
  exit 0
fi

echo "" >&2
echo "⛔ No claimed bd issue." >&2
echo "" >&2
echo "   Edit blocked: $FILE_PATH" >&2
echo "" >&2
echo "   Source-file edits require a claimed bd issue (in_progress)." >&2
echo "   Run /work-next to claim the next ready issue, or:" >&2
echo "" >&2
echo "     bd ready                    # see available work" >&2
echo "     bd update <id> --claim      # claim it explicitly" >&2
echo "" >&2
exit 2
