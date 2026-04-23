#!/usr/bin/env bash
# PreCompact hook — re-primes project-specific context after /compact.
#
# CLAUDE.md is re-injected automatically after compaction (per Claude Code
# docs). Project state that does NOT survive — beads queue, .dev.config.json
# values stringified into the session — needs an explicit re-prime here.
set -euo pipefail

CONFIG_FILE=".dev.config.json"
context="Context restored after /compact."

if [[ -f "$CONFIG_FILE" ]]; then
  language=$(jq -r '.language // empty' "$CONFIG_FILE")
  variant=$(jq -r '.variant // empty' "$CONFIG_FILE")
  workflow=$(jq -r '.workflow // empty' "$CONFIG_FILE")
  context="$context
Project: $variant ($language) | workflow: $workflow"

  if command -v bd >/dev/null 2>&1; then
    # bd prime is the "full workflow reminder" — it's the canonical re-prime.
    bd_prime=$(bd prime 2>/dev/null || true)
    ready=$(bd ready 2>/dev/null | head -5 || true)
    if [[ -n "$bd_prime" ]]; then
      context="$context

$bd_prime"
    fi
    if [[ -n "$ready" ]]; then
      context="$context

Beads ready queue:
$ready"
    fi
  fi
fi

jq -n --arg ctx "$context" '{
  hookSpecificOutput: {
    hookEventName: "PreCompact",
    additionalContext: $ctx
  }
}'
