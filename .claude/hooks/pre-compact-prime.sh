#!/usr/bin/env bash
# PreCompact hook — re-primes harness-specific context after /compact.
#
# CLAUDE.md re-injects automatically post-compact. The beads marketplace
# plugin's own PreCompact hook re-runs `bd prime`, so this hook only needs
# to re-emit the harness-managed metadata that does not survive compaction
# (project type, workflow, communication mode reminder).
set -euo pipefail

CONFIG_FILE=".dev.config.json"
context="Context restored after /compact. Caveman mode persists from session start (off only with: stop caveman / normal mode)."

if [[ -f "$CONFIG_FILE" ]]; then
  language=$(jq -r '.language // empty' "$CONFIG_FILE")
  variant=$(jq -r '.variant // empty' "$CONFIG_FILE")
  workflow=$(jq -r '.workflow // empty' "$CONFIG_FILE")
  context="$context
Project: $variant ($language) | workflow: $workflow"
fi

jq -n --arg ctx "$context" '{
  hookSpecificOutput: {
    hookEventName: "PreCompact",
    additionalContext: $ctx
  }
}'
