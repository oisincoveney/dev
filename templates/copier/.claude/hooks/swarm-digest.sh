#!/usr/bin/env bash
# Stop hook — emits a one-block digest of any active swarm(s) so the user has
# end-of-cycle visibility without per-step pings.
#
# Format:
#   SWARM DIGEST — <epic-title>
#     <closed_n> closed  ·  <in_progress_n> in_progress  ·  <blocked_n> blocked
#     <discovered_n> discovered-from filed
#     <human_n> human-flagged
#
# Silent if no active swarm or bd missing. Never blocks.
set -uo pipefail

INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // "."' 2>/dev/null || echo ".")

command -v bd >/dev/null 2>&1 || exit 0
[[ -d "$CWD/.beads" ]] || exit 0

cd "$CWD"

# Fast path: exported beads state has no open epics, so no active swarm can
# exist. Avoid starting bd on every Stop; bd can be slow when the embedded Dolt
# store is locked by another process.
if [[ -f ".beads/issues.jsonl" ]]; then
  if ! jq -e 'select(.issue_type == "epic" and .status != "closed")' .beads/issues.jsonl >/dev/null 2>&1; then
    exit 0
  fi
fi

bd_json() {
  local deadline
  local out_file
  local status_file
  local pid
  local status
  deadline=$(awk -v now="$SECONDS" -v wait="${OISIN_DEV_SWARM_DIGEST_TIMEOUT_SECONDS:-1}" 'BEGIN { print now + wait }')
  out_file=$(mktemp "${TMPDIR:-/tmp}/swarm-digest-out.XXXXXX") || return 1
  status_file=$(mktemp "${TMPDIR:-/tmp}/swarm-digest-status.XXXXXX") || {
    rm -f "$out_file"
    return 1
  }
  (bd "$@" >"$out_file" 2>/dev/null; printf '%s\n' "$?" >"$status_file") &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    if awk -v now="$SECONDS" -v deadline="$deadline" 'BEGIN { exit !(now >= deadline) }'; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      rm -f "$out_file" "$status_file"
      return 1
    fi
    sleep 0.05
  done
  wait "$pid" 2>/dev/null || true
  status=$(cat "$status_file" 2>/dev/null || echo 1)
  if [[ "$status" == "0" ]]; then
    cat "$out_file"
  fi
  rm -f "$out_file" "$status_file"
  [[ "$status" == "0" ]]
}

# Find epics that have at least one in_progress or recently-closed child. Trust
# an explicit empty swarm list; the old fallback must only run when the swarm
# command is unavailable or returns an unparseable shape.
RAW_SWARMS=$(bd_json swarm list --json || echo "")
SWARMS=$(
  printf '%s' "$RAW_SWARMS" \
    | jq -c 'if type == "array" then . elif type == "object" and (.swarms | type) == "array" then .swarms else null end' 2>/dev/null \
    || echo "null"
)
if [[ "$SWARMS" == "null" || -z "$SWARMS" ]]; then
  # Fallback for older bd builds without `swarm list`.
  SWARMS=$(bd_json list --type=epic --status=open --json || echo "[]")
fi

COUNT=$(echo "$SWARMS" | jq -r 'length' 2>/dev/null || echo "0")
[[ "$COUNT" -eq 0 ]] && exit 0

OUTPUT=""
for ROW in $(echo "$SWARMS" | jq -r '.[] | @base64' 2>/dev/null); do
  EPIC_JSON=$(echo "$ROW" | base64 --decode 2>/dev/null || echo "")
  EPIC_ID=$(echo "$EPIC_JSON" | jq -r '.id // empty')
  EPIC_TITLE=$(echo "$EPIC_JSON" | jq -r '.title // empty')
  [[ -z "$EPIC_ID" ]] && continue

  CHILDREN=$(bd_json list --parent="$EPIC_ID" --json || echo "[]")
  TOTAL=$(echo "$CHILDREN" | jq 'length' 2>/dev/null || echo "0")
  [[ "$TOTAL" -eq 0 ]] && continue

  CLOSED=$(echo "$CHILDREN" | jq '[.[] | select(.status == "closed")] | length' 2>/dev/null || echo "0")
  INPROG=$(echo "$CHILDREN" | jq '[.[] | select(.status == "in_progress")] | length' 2>/dev/null || echo "0")
  BLOCKED=$(echo "$CHILDREN" | jq '[.[] | select(.status == "blocked")] | length' 2>/dev/null || echo "0")
  DISCOVERED=$(echo "$CHILDREN" | jq '[.[] | select(.deps.discovered_from != null and .deps.discovered_from != "")] | length' 2>/dev/null || echo "0")
  HUMAN=$(echo "$CHILDREN" | jq '[.[] | select(.human == true)] | length' 2>/dev/null || echo "0")

  # Skip swarms with no in_progress and 100% closed (don't spam digest for done work).
  if [[ "$INPROG" -eq 0 && "$BLOCKED" -eq 0 && "$CLOSED" -eq "$TOTAL" && "$HUMAN" -eq 0 ]]; then
    continue
  fi

  OUTPUT+=$'\n'"SWARM DIGEST — $EPIC_ID · $EPIC_TITLE"
  OUTPUT+=$'\n'"  $CLOSED closed  ·  $INPROG in_progress  ·  $BLOCKED blocked  ·  total $TOTAL"
  if [[ "$DISCOVERED" -gt 0 ]]; then
    OUTPUT+=$'\n'"  $DISCOVERED discovered-from filed"
  fi
  if [[ "$HUMAN" -gt 0 ]]; then
    OUTPUT+=$'\n'"  ⚑ $HUMAN human-flagged — review with: bd human list"
  fi
done

[[ -z "$OUTPUT" ]] && exit 0

# Emit as additionalContext so it appears in the chat tail.
jq -n --arg ctx "$OUTPUT" '{
  hookSpecificOutput: {
    hookEventName: "Stop",
    additionalContext: $ctx
  }
}'

exit 0
