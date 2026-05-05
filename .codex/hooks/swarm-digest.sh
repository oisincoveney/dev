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

# Find epics that have at least one in_progress or recently-closed child — those
# are the active swarms. `bd swarm list --json` if available, else fall back to
# enumerating epics with in_progress children.
SWARMS=$(bd swarm list --json 2>/dev/null || echo "[]")
if [[ "$SWARMS" == "[]" ]]; then
  # Fallback: enumerate epics with ≥1 in_progress child.
  SWARMS=$(bd list --type=epic --status=open --json 2>/dev/null || echo "[]")
fi

COUNT=$(echo "$SWARMS" | jq -r 'length' 2>/dev/null || echo "0")
[[ "$COUNT" -eq 0 ]] && exit 0

OUTPUT=""
for ROW in $(echo "$SWARMS" | jq -r '.[] | @base64' 2>/dev/null); do
  EPIC_JSON=$(echo "$ROW" | base64 --decode 2>/dev/null || echo "")
  EPIC_ID=$(echo "$EPIC_JSON" | jq -r '.id // empty')
  EPIC_TITLE=$(echo "$EPIC_JSON" | jq -r '.title // empty')
  [[ -z "$EPIC_ID" ]] && continue

  CHILDREN=$(bd list --parent="$EPIC_ID" --json 2>/dev/null || echo "[]")
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
