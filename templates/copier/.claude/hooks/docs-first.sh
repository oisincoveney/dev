#!/usr/bin/env bash
# PreToolUse hook for Read|Glob — blocks reads into buried dependency
# directories so the agent cannot "verify" hallucinated APIs by spelunking
# stale node_modules content. Forces WebFetch on official docs first.
#
# Override per-turn with env ALLOW_DEPS_READ=1.
set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // .tool_input.pattern // empty' 2>/dev/null)

[[ -z "$FILE_PATH" ]] && exit 0

if [[ -n "${ALLOW_DEPS_READ:-}" ]]; then
  exit 0
fi

case "$FILE_PATH" in
  node_modules/*|*/node_modules/*) ;;
  dist/*|*/dist/*) ;;
  build/*|*/build/*) ;;
  .next/*|*/.next/*) ;;
  target/*|*/target/*) ;;
  generated/*|*/generated/*) ;;
  out/*|*/out/*) ;;
  *) exit 0 ;;
esac

echo "" >&2
echo "⛔ Read into a buried dependency directory blocked." >&2
echo "" >&2
echo "   Path: $FILE_PATH" >&2
echo "" >&2
echo "   Use WebFetch on official docs first — they're the authoritative" >&2
echo "   source. Buried dependency files are stale relative to upstream and" >&2
echo "   reading them tends to confirm hallucinations rather than catch them." >&2
echo "" >&2
echo "   If pinned local behavior is genuinely what matters here, set" >&2
echo "   ALLOW_DEPS_READ=1 in your env for this turn and explain why in" >&2
echo "   your response." >&2
exit 2
