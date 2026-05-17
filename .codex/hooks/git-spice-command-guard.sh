#!/usr/bin/env bash
# PreToolUse hook for Bash — routes stack-aware Git/GitHub operations through
# git-spice so branch relationships, restacks, submits, and PR metadata stay
# coherent.
set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
if [[ -z "$COMMAND" ]]; then
  exit 0
fi

# Strip heredoc bodies before scanning. Pattern: <<'TAG' ... TAG  or  <<TAG ... TAG.
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
  echo "BLOCKED: $msg" >&2
  [[ -n "$alt" ]] && echo "Use: $alt" >&2
  exit 2
}

has_command() {
  local pattern=$1
  printf '%s\n' "$SCAN" | grep -qE "(^|[;&|[:space:]])${pattern}([[:space:];&|]|$)"
}

GIT_PREFIX='git([[:space:]]+(-C|-c|--git-dir|--work-tree|--namespace)([=[:space:]][^[:space:];&|]+)?|[[:space:]]+--[A-Za-z0-9-]+(=[^[:space:];&|]+)?)*[[:space:]]+'

if has_command "${GIT_PREFIX}commit"; then
  if printf '%s\n' "$SCAN" | grep -qE "(^|[;&|[:space:]])${GIT_PREFIX}commit[[:space:]][^;&|]*--amend([[:space:];&|]|$)"; then
    block "git-spice owns stack-aware commit amendments." "git-spice commit amend"
  fi
  block "git-spice owns stack-aware commit creation." "git-spice commit create"
fi

if has_command "${GIT_PREFIX}push"; then
  block "git-spice owns stack branch publication and PR submission." "git-spice stack submit"
fi

if has_command "${GIT_PREFIX}rebase"; then
  block "git-spice owns stack restacking." "git-spice stack restack"
fi

if has_command "${GIT_PREFIX}switch"; then
  block "git-spice owns stack branch navigation." "git-spice branch checkout"
fi

if printf '%s\n' "$SCAN" | grep -qE "(^|[;&|[:space:]])${GIT_PREFIX}checkout[[:space:]]+(-b|-B|--track|--orphan|@\{-1\}|(main|master|release/|task/|quick/|feature/|feat/|fix/|chore/|bugfix/)[A-Za-z0-9._/-]*)([[:space:];&|]|$)"; then
  block "git-spice owns stack branch creation and checkout." "git-spice branch create or git-spice branch checkout"
fi

if printf '%s\n' "$SCAN" | grep -qE "(^|[;&|[:space:]])${GIT_PREFIX}branch[[:space:]]+(-[dDmMcC]|--delete|--move|--copy|--set-upstream-to|[[:alnum:]_.][[:alnum:]_./-]*)([[:space:];&|]|$)"; then
  block "git-spice owns stack branch creation, deletion, rename, and tracking." "git-spice branch create, git-spice branch delete, or git-spice branch track"
fi

if printf '%s\n' "$SCAN" | grep -qE '(^|[;&|[:space:]])gh[[:space:]]+pr[[:space:]]+(create|edit|ready|close|reopen)([[:space:];&|]|$)'; then
  block "git-spice owns stack PR creation and updates." "git-spice branch submit or git-spice stack submit"
fi

exit 0
