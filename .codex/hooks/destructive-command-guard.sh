#!/usr/bin/env bash
# PreToolUse hook for Bash — blocks destructive commands and rewrites
# salvageable ones (e.g., strips --no-verify) per Claude Code 2.0.10+
# input-rewriting JSON.
#
# Heredoc bodies are excluded from substring checks: the literal text of
# a heredoc is data, not an executable subcommand. Otherwise we'd block
# any `bd create --body-file=- <<EOF ... <destructive substring> ... EOF`
# that documents the very patterns this hook blocks.
set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
if [[ -z "$COMMAND" ]]; then
  exit 0
fi

# Strip heredoc bodies before scanning. Pattern: <<'TAG' ... TAG  or  <<TAG ... TAG.
# Bash-native state machine; portable across macOS BSD utils and Linux GNU.
strip_heredocs() {
  local in_heredoc=0
  local tag=""
  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ $in_heredoc -eq 0 ]]; then
      if [[ "$line" =~ \<\<[[:space:]]*[\'\"]*([A-Za-z_][A-Za-z0-9_]*)[\'\"]*[[:space:]]* ]]; then
        tag="${BASH_REMATCH[1]}"
        in_heredoc=1
      fi
      printf '%s\n' "$line"
    else
      local trimmed="${line//[[:space:]]/}"
      if [[ "$trimmed" == "$tag" ]]; then
        in_heredoc=0
        tag=""
        printf '%s\n' "$line"
      fi
    fi
  done
}

SCAN=$(printf '%s\n' "$COMMAND" | strip_heredocs)

block() {
  local msg=$1
  local alt=$2
  echo "⛔ BLOCKED: $msg" >&2
  [[ -n "$alt" ]] && echo "   $alt" >&2
  exit 2
}

if echo "$SCAN" | grep -qE 'git[[:space:]]+reset[[:space:]]+--hard'; then
  block "git reset --hard is destructive and irreversible." \
        "Use git stash or git checkout <file> for targeted rollbacks."
fi

if echo "$SCAN" | grep -qE 'git[[:space:]]+push[[:space:]]+.*--force\b|git[[:space:]]+push[[:space:]]+-f\b'; then
  block "Force push can destroy remote history." \
        "Use --force-with-lease if you must, or ask first."
fi

if echo "$SCAN" | grep -qE 'git[[:space:]]+clean[[:space:]]+-[a-zA-Z]*f'; then
  block "git clean -f permanently deletes untracked files." ""
fi

if echo "$SCAN" | grep -qE 'git[[:space:]]+checkout[[:space:]]+\.\s*$|git[[:space:]]+checkout[[:space:]]+--[[:space:]]+\.'; then
  block "git checkout . discards all unstaged changes." \
        "Target specific files instead."
fi

if echo "$SCAN" | grep -qE 'git[[:space:]]+restore[[:space:]]+\.\s*$|git[[:space:]]+restore[[:space:]]+--staged[[:space:]]+\.'; then
  block "git restore . discards all changes." "Target specific files instead."
fi

if echo "$SCAN" | grep -qE 'git[[:space:]]+branch[[:space:]]+-D\b'; then
  block "git branch -D force-deletes a branch." "Use -d (safe delete) instead."
fi

if echo "$SCAN" | grep -qE 'rm[[:space:]]+-[a-zA-Z]*r[a-zA-Z]*f|rm[[:space:]]+-[a-zA-Z]*f[a-zA-Z]*r|rm[[:space:]]+-rf'; then
  block "rm -rf is irreversible." "Delete specific files by name instead."
fi

if echo "$SCAN" | grep -qiE 'DROP[[:space:]]+(TABLE|DATABASE|SCHEMA)\b'; then
  block "DROP TABLE/DATABASE is irreversible." ""
fi

if echo "$SCAN" | grep -qE '(npm|yarn|bun|pnpm)[[:space:]]+publish'; then
  block "Package publishing must be done manually." \
        "Publishing has permanent side effects. Run this yourself."
fi

# Rewriting path: strip --no-verify from git commit/push if present.
if echo "$SCAN" | grep -qE 'git[[:space:]]+(commit|push)[[:space:]]+.*--no-verify'; then
  REWRITTEN=$(printf '%s' "$COMMAND" | sed -E 's/[[:space:]]+--no-verify([[:space:]]|$)/\1/g; s/--no-verify[[:space:]]*//g')
  jq -n --arg cmd "$REWRITTEN" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: "Stripped --no-verify; project policy is hooks must run.",
      updatedInput: { command: $cmd }
    }
  }'
  exit 0
fi

exit 0
