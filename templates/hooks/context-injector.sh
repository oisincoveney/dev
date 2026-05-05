#!/usr/bin/env bash
# UserPromptSubmit hook — emits only genuinely-per-turn state.
#
# Static payload (commands, deps, workflow, variant) lives in the
# SessionStart hook instead (context-bootstrap.sh). This hook fires on
# every prompt, so keep it <10 lines and only surface things that can
# actually change between turns.
set -euo pipefail

branch=$(git branch --show-current 2>/dev/null || true)
if [[ -z "$branch" ]]; then
  exit 0
fi

line="Branch: $branch"

if command -v bd >/dev/null 2>&1; then
  top=$(bd ready 2>/dev/null | head -1 || true)
  if [[ -n "$top" && "$top" != *"no ready"* ]]; then
    line="$line | Top ready: $top"
  fi
fi

printf '<turn-context>%s</turn-context>\n' "$line"
exit 0
