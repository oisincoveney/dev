#!/usr/bin/env bash
# PreCompact hook — re-primes harness-specific context after /compact.
#
# Re-emit harness-managed metadata that does not survive compaction
# (project type, workflow, communication mode reminder).
set -euo pipefail

context="Context restored after /compact. Caveman mode persists from session start (off only with: stop caveman / normal mode)."

state_file=".oisin-dev.yml"

if [[ -f "$state_file" ]]; then
  language=$(awk -F': ' '/^language:/ {print $2; exit}' "$state_file" | tr -d '"' || true)
  variant=$(awk -F': ' '/^variant:/ {print $2; exit}' "$state_file" | tr -d '"' || true)
  workflow=$(awk -F': ' '/^workflow:/ {print $2; exit}' "$state_file" | tr -d '"' || true)
  context="$context
Project: $variant ($language) | workflow: $workflow"
fi

jq -n --arg ctx "$context" '{
  hookSpecificOutput: {
    hookEventName: "PreCompact",
    additionalContext: $ctx
  }
}'
