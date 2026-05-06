#!/usr/bin/env bash
# UserPromptSubmit hook — emits branch-only context for non-beads projects.
#
# Static payload (commands, deps, workflow, variant) lives in the
# SessionStart hook instead (context-bootstrap.sh). This hook fires on
# every prompt, so keep it tiny and only surface things that can actually
# change between turns.
set -euo pipefail

branch=$(git branch --show-current 2>/dev/null || true)
if [[ -z "$branch" ]]; then
  exit 0
fi

printf '<turn-context>Branch: %s</turn-context>\n' "$branch"
exit 0
