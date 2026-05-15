#!/usr/bin/env bash
# PreCompact hook — re-primes harness-specific context after /compact.
#
# CLAUDE.md re-injects automatically post-compact. The beads marketplace
# plugin's own PreCompact hook re-runs `bd prime`, so this hook only needs
# to re-emit the harness-managed metadata that does not survive compaction
# (project type, workflow, communication mode reminder).
set -euo pipefail

context="Context restored after /compact. Caveman mode persists from session start (off only with: stop caveman / normal mode)."

if [[ -f ".copier-answers.yml" ]]; then
  language=$(awk -F': ' '/^language:/ {print $2; exit}' .copier-answers.yml | tr -d '"' || true)
  variant=$(awk -F': ' '/^variant:/ {print $2; exit}' .copier-answers.yml | tr -d '"' || true)
  workflow=$(awk -F': ' '/^workflow:/ {print $2; exit}' .copier-answers.yml | tr -d '"' || true)
  context="$context
Project: $variant ($language) | workflow: $workflow"
fi

jq -n --arg ctx "$context" '{
  hookSpecificOutput: {
    hookEventName: "PreCompact",
    additionalContext: $ctx
  }
}'
