#!/usr/bin/env bash
# UserPromptSubmit hook — injects compact bd state into the agent's context.
# Never blocks.
#
# Silent no-op when bd is missing or .beads/ does not exist.
set -uo pipefail

INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // "."' 2>/dev/null || echo ".")

command -v bd >/dev/null 2>&1 || exit 0
[[ -d "$CWD/.beads" ]] || exit 0

cd "$CWD"

BRANCH=$(git branch --show-current 2>/dev/null || echo "")
CLAIMED=$(
  bd list --status in_progress --json 2>/dev/null \
    | jq -r '[.[] | "\(.id) [\(.priority // "P?")] \(.title)"] | join("; ")' 2>/dev/null \
    || echo ""
)

if [[ -n "$CLAIMED" ]]; then
  STATE="Claimed: $CLAIMED"
else
  READY=$(
    bd ready --json 2>/dev/null \
      | jq -r '.[0] | if . == null then "" else "Ready: \(.id) [\(.priority // "P?")] \(.title)" end' 2>/dev/null \
      || echo ""
  )
  if [[ -n "$READY" ]]; then
    STATE="$READY"
  else
    STATE="No claimed bd issue"
  fi
fi

if [[ -n "$BRANCH" ]]; then
  CONTEXT="<turn-context>Branch: $BRANCH | $STATE</turn-context>"
else
  CONTEXT="<turn-context>$STATE</turn-context>"
fi

jq -n --arg ctx "$CONTEXT" '{
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: $ctx
  }
}'

exit 0
