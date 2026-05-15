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

run_bd_bounded() {
  out_file=$(mktemp "${TMPDIR:-/tmp}/bd-context.XXXXXX")
  status_file=$(mktemp "${TMPDIR:-/tmp}/bd-context-status.XXXXXX")
  (bd "$@" >"$out_file" 2>/dev/null; printf '%s\n' "$?" >"$status_file") &
  pid=$!
  (
    sleep "${OISIN_DEV_BD_CONTEXT_TIMEOUT:-2}"
    kill "$pid" 2>/dev/null || true
  ) &
  killer=$!
  wait "$pid" 2>/dev/null || true
  kill "$killer" 2>/dev/null || true
  status=$(cat "$status_file" 2>/dev/null || echo 1)
  if [[ "$status" == "0" ]]; then
    cat "$out_file"
  fi
  rm -f "$out_file" "$status_file"
}

BRANCH=$(git branch --show-current 2>/dev/null || echo "")
CLAIMED=$(
  run_bd_bounded list --status in_progress --json \
    | jq -r '[.[] | "\(.id) [\(.priority // "P?")] \(.title)"] | join("; ")' 2>/dev/null \
    || echo ""
)

if [[ -n "$CLAIMED" ]]; then
  STATE="Claimed: $CLAIMED"
else
  READY=$(
    run_bd_bounded ready --json \
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
