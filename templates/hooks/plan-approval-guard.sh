#!/usr/bin/env bash
# PreToolUse hook (Bash matcher) — gates `bd create --graph --parent=<id>` and
# `bd swarm create <id>` on the parent epic having user approval.
#
# Approval state lives in beads:
#   - The epic's `human` flag must be `false` (cleared by /approve slash command).
#   - A `bd remember "plan-approved:<id>:<sha>"` entry must exist where <sha>
#     matches the current sha256 of the epic's description.
#
# Fail-open if bd is missing or the epic doesn't exist (other gates handle).

set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
[[ -z "$COMMAND" ]] && exit 0

# We gate two patterns:
#   bd create --graph ... --parent=<id>
#   bd swarm create <id>
# Extract the parent epic id; if neither matches, exit 0.
EPIC_ID=""

if echo "$COMMAND" | grep -qE 'bd[[:space:]]+create[[:space:]]+.*--graph\b.*--parent[= ]'; then
  EPIC_ID=$(echo "$COMMAND" | grep -oE -- '--parent[= ][A-Za-z0-9.-]+' | head -1 | sed -E 's/^--parent[= ]//')
elif echo "$COMMAND" | grep -qE 'bd[[:space:]]+swarm[[:space:]]+create\b'; then
  EPIC_ID=$(echo "$COMMAND" | sed -nE 's/.*bd[[:space:]]+swarm[[:space:]]+create[[:space:]]+([A-Za-z0-9.-]+).*/\1/p' | head -1)
fi

[[ -z "$EPIC_ID" ]] && exit 0

command -v bd >/dev/null 2>&1 || exit 0

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
[[ -d "$REPO_ROOT/.beads" ]] || exit 0

# Read the epic. Fail-open if it doesn't exist (might be a brand-new graph payload
# in stage 1 — but we already gated stage 1 separately).
EPIC_JSON=$(bd show "$EPIC_ID" --json 2>/dev/null || echo "")
[[ -z "$EPIC_JSON" ]] && exit 0

# Check `human` flag. bd represents this either as a top-level boolean field
# or via the human-decision listing (`bd human list --json`). Try the JSON
# first, fall back to human list.
HUMAN_FLAG=$(echo "$EPIC_JSON" | jq -r '.human // .human_decision_pending // false' 2>/dev/null)
if [[ "$HUMAN_FLAG" == "null" ]]; then HUMAN_FLAG="false"; fi
if [[ "$HUMAN_FLAG" != "true" && "$HUMAN_FLAG" != "false" ]]; then
  # Fall back: ask `bd human list` for active flags on this id.
  ACTIVE=$(bd human list --json 2>/dev/null | jq -r --arg id "$EPIC_ID" '[.[] | select(.id == $id and (.dismissed // false | not))] | length' 2>/dev/null || echo "0")
  if [[ "$ACTIVE" -gt 0 ]]; then HUMAN_FLAG="true"; else HUMAN_FLAG="false"; fi
fi

if [[ "$HUMAN_FLAG" == "true" ]]; then
  echo "" >&2
  echo "⛔ Plan approval required." >&2
  echo "" >&2
  echo "   Epic $EPIC_ID has human:1 (plan-review pending)." >&2
  echo "   Children/swarm cannot be created until the user runs:" >&2
  echo "" >&2
  echo "     /approve $EPIC_ID" >&2
  echo "" >&2
  echo "   Or to revise the plan:" >&2
  echo "     /regrill $EPIC_ID <topic>" >&2
  echo "     /reject $EPIC_ID <reason>" >&2
  echo "" >&2
  exit 2
fi

# Compute current description hash.
DESC=$(echo "$EPIC_JSON" | jq -r '.description // .body // ""')
CURRENT_SHA=$(printf '%s' "$DESC" | shasum -a 256 | awk '{print $1}')

# Look up approval memory entry for this exact body hash.
# bd memories returns text matches — search for "plan-approved:<id>:<sha>".
APPROVAL_KEY="plan-approved:${EPIC_ID}:${CURRENT_SHA}"
HIT=$(bd memories "$APPROVAL_KEY" 2>/dev/null | grep -c "$APPROVAL_KEY" || echo "0")

if [[ "$HIT" -lt 1 ]]; then
  # Check whether ANY plan-approved entry exists for this epic — to give a
  # better error message ("body changed since approval" vs "never approved").
  ANY=$(bd memories "plan-approved:${EPIC_ID}:" 2>/dev/null | grep -c "plan-approved:${EPIC_ID}:" || echo "0")
  echo "" >&2
  if [[ "$ANY" -gt 0 ]]; then
    echo "⛔ Epic body has changed since approval." >&2
    echo "" >&2
    echo "   Epic $EPIC_ID was approved against a different description hash." >&2
    echo "   Either restore the original body, or re-approve:" >&2
    echo "     /regrill $EPIC_ID <topic>   (revise & re-approve)" >&2
    echo "     /approve $EPIC_ID            (re-approve current body as-is)" >&2
  else
    echo "⛔ Plan approval required." >&2
    echo "" >&2
    echo "   Epic $EPIC_ID has no plan-approved memory entry." >&2
    echo "   The user must run:" >&2
    echo "     /approve $EPIC_ID" >&2
  fi
  echo "" >&2
  exit 2
fi

exit 0
