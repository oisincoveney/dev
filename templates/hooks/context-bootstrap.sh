#!/usr/bin/env bash
# SessionStart hook — injects project context and enforces superpowers skill invocation.
set -euo pipefail

CONFIG_FILE=".dev.config.json"

context="IMPORTANT: Your FIRST action this session must be to invoke the using-superpowers skill via the Skill tool, before responding to the user or taking any other action."

if [[ -f "$CONFIG_FILE" ]]; then
  language=$(jq -r '.language // empty' "$CONFIG_FILE")
  variant=$(jq -r '.variant // empty' "$CONFIG_FILE")
  workflow=$(jq -r '.workflow // empty' "$CONFIG_FILE")

  project_info="Project: $variant ($language) | workflow: $workflow"

  if command -v bd >/dev/null 2>&1; then
    ready=$(bd ready 2>/dev/null | head -5 || echo "(bd not initialized or no ready work)")
    project_info="$project_info
Beads ready queue:
$ready"
  fi

  context="$context

$project_info"
fi

jq -n --arg ctx "$context" '{
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: $ctx
  }
}'
