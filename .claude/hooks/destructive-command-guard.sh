#!/usr/bin/env bash
# PreToolUse hook for Bash — blocks destructive commands.
# Exit 0 = allow, Exit 2 = hard block.
set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
if [[ -z "$COMMAND" ]]; then
  exit 0
fi

block() {
  local msg=$1
  local alt=$2
  echo "⛔ BLOCKED: $msg" >&2
  [[ -n "$alt" ]] && echo "   $alt" >&2
  exit 2
}

if echo "$COMMAND" | grep -qE 'git[[:space:]]+reset[[:space:]]+--hard'; then
  block "git reset --hard is destructive and irreversible." \
        "Use git stash or git checkout <file> for targeted rollbacks."
fi

if echo "$COMMAND" | grep -qE 'git[[:space:]]+push[[:space:]]+.*--force\b|git[[:space:]]+push[[:space:]]+-f\b'; then
  block "Force push can destroy remote history." \
        "Use --force-with-lease if you must, or ask first."
fi

if echo "$COMMAND" | grep -qE 'git[[:space:]]+clean[[:space:]]+-[a-zA-Z]*f'; then
  block "git clean -f permanently deletes untracked files." ""
fi

if echo "$COMMAND" | grep -qE 'git[[:space:]]+checkout[[:space:]]+\.\s*$|git[[:space:]]+checkout[[:space:]]+--[[:space:]]+\.'; then
  block "git checkout . discards all unstaged changes." \
        "Target specific files instead."
fi

if echo "$COMMAND" | grep -qE 'git[[:space:]]+restore[[:space:]]+\.\s*$|git[[:space:]]+restore[[:space:]]+--staged[[:space:]]+\.'; then
  block "git restore . discards all changes." "Target specific files instead."
fi

if echo "$COMMAND" | grep -qE 'git[[:space:]]+branch[[:space:]]+-D\b'; then
  block "git branch -D force-deletes a branch." "Use -d (safe delete) instead."
fi

if echo "$COMMAND" | grep -qE 'rm[[:space:]]+-[a-zA-Z]*r[a-zA-Z]*f|rm[[:space:]]+-[a-zA-Z]*f[a-zA-Z]*r|rm[[:space:]]+-rf'; then
  block "rm -rf is irreversible." "Delete specific files by name instead."
fi

if echo "$COMMAND" | grep -qiE 'DROP[[:space:]]+(TABLE|DATABASE|SCHEMA)\b'; then
  block "DROP TABLE/DATABASE is irreversible." ""
fi

if echo "$COMMAND" | grep -qE '(npm|yarn|bun|pnpm)[[:space:]]+publish'; then
  block "Package publishing must be done manually." \
        "Publishing has permanent side effects. Run this yourself."
fi

exit 0
