#!/usr/bin/env bash
# UserPromptSubmit hook — injects current bd state (in_progress claim + top of
# ready queue) into the agent's context as additionalContext. Never blocks.
#
# Silent no-op when bd is missing or .beads/ does not exist.
set -uo pipefail

INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // "."' 2>/dev/null || echo ".")

command -v bd >/dev/null 2>&1 || exit 0
[[ -d "$CWD/.beads" ]] || exit 0

cd "$CWD"

CLAIMED=$(bd list --status in_progress --json 2>/dev/null | jq -r '.[] | "  - \(.id) [\(.priority // "P?")] \(.title)"' 2>/dev/null || echo "")

READY=$(bd ready --json 2>/dev/null | jq -r '.[0:3] | .[] | "  - \(.id) [\(.priority // "P?")] \(.title)"' 2>/dev/null || echo "")

CONTEXT="bd state:"
if [[ -n "$CLAIMED" ]]; then
  CONTEXT="$CONTEXT
in_progress claim(s):
$CLAIMED"
else
  CONTEXT="$CONTEXT
in_progress: (none claimed)"
fi
if [[ -n "$READY" ]]; then
  CONTEXT="$CONTEXT
top of ready queue:
$READY"
else
  CONTEXT="$CONTEXT
ready queue: (empty)"
fi

jq -n --arg ctx "$CONTEXT" '{
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: $ctx
  }
}'

exit 0
