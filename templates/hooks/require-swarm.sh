#!/usr/bin/env bash
# PreToolUse hook for Write|Edit — denies source-file edits when the claimed
# bd issue's parent epic has no swarm registered. Forces multi-file work
# through the `bd swarm create <epic>` gate before any code change.
#
# Fail-open when: bd missing, no in_progress claim, claim has no parent epic,
# or the swarm lookup fails for non-policy reasons.
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

CLAIMED_ID=$(bd list --status in_progress --json 2>/dev/null | jq -r '.[0].id // empty' 2>/dev/null || echo "")
[[ -z "$CLAIMED_ID" ]] && exit 0

PARENT_LINE=$(bd show "$CLAIMED_ID" 2>/dev/null | grep -A2 '^PARENT' | grep -E '↑.*\[?EPIC|: \(EPIC\)' | head -1 || true)
[[ -z "$PARENT_LINE" ]] && exit 0

PARENT_EPIC_ID=$(printf '%s' "$PARENT_LINE" | grep -oE '[a-z][a-z0-9-]*-[a-z0-9]+' | head -1 || true)
[[ -z "$PARENT_EPIC_ID" ]] && exit 0

SWARM_REGISTERED=$(bd swarm list --json 2>/dev/null | jq -r --arg id "$PARENT_EPIC_ID" '.swarms[]? | select(.epic_id == $id) | .epic_id' 2>/dev/null || echo "")

if [[ -n "$SWARM_REGISTERED" ]]; then
  exit 0
fi

echo "" >&2
echo "⛔ No swarm registered for the parent epic of your claimed ticket." >&2
echo "" >&2
echo "   Claimed: $CLAIMED_ID" >&2
echo "   Parent epic: $PARENT_EPIC_ID" >&2
echo "" >&2
echo "   Multi-ticket epics need a registered swarm before source edits." >&2
echo "   Run:  bd swarm create $PARENT_EPIC_ID" >&2
echo "" >&2
echo "   Then retry the edit." >&2
exit 2
