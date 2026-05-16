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

if echo "$SCAN" | grep -qE '(^|[;&|[:space:]])git[[:space:]]+clone([[:space:];&|]|$)'; then
  block "Full repo clones are blocked for agent work." \
        "Use Worktrunk: WORKTRUNK_WORKTREE_PATH='\${PWD}/.agents/worktrees/{{ branch | sanitize }}' wt switch --create <branch>."
fi

if echo "$SCAN" | grep -qE '(^|[;&|[:space:]])gh[[:space:]]+repo[[:space:]]+clone([[:space:];&|]|$)'; then
  block "GitHub repo clones are blocked for agent work." \
        "Use the existing checkout and create a Worktrunk worktree under .agents/worktrees/."
fi

if echo "$SCAN" | grep -qE '(^|[;&|[:space:]])cd[[:space:]]+(/private)?/tmp([/[:space:];&|]|$).*(git[[:space:]]+clone|gh[[:space:]]+repo[[:space:]]+clone)'; then
  block "Cloning from /tmp or /private/tmp is blocked for agent work." \
        "Use Worktrunk-managed worktrees under .agents/worktrees/."
fi

if echo "$SCAN" | grep -qE '(^|[;&|[:space:]])(export[[:space:]]+)?TMPDIR=' ||
   echo "$SCAN" | grep -qE '(^|[;&|[:space:]])env[[:space:]][^;&|]*TMPDIR='; then
  block "TMPDIR overrides are blocked for repo work." \
        "Use the repository checkout and Worktrunk worktree lifecycle tasks instead of temp scratch space."
fi

if echo "$SCAN" | grep -qE 'git[[:space:]]+reset[[:space:]]+--hard'; then
  block "git reset --hard is destructive and irreversible." \
        "Use git stash or git checkout <file> for targeted rollbacks."
fi

if echo "$SCAN" | grep -qE 'git[[:space:]]+push\b'; then
  if echo "$SCAN" | grep -qE 'git[[:space:]]+push([[:space:]][^;&|]*)?[[:space:]]+(origin[[:space:]]+)?(main|master|release/[A-Za-z0-9._/-]+)([[:space:];&|]|$)'; then
    block "Pushing protected branches requires explicit user approval." \
          "Protected branches: main, master, release/*."
  fi
  if echo "$SCAN" | grep -qE 'git[[:space:]]+push[[:space:]].*(refs/tags/|--tags\b|[[:space:]]tag[[:space:]])'; then
    block "Pushing tags requires explicit user approval." ""
  fi
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

is_allowed_curl_file_url() {
  local url=$1
  case "$url" in
    https://github.com/*/blob/*|http://github.com/*/blob/*)
      return 1
      ;;
    https://raw.githubusercontent.com/*|http://raw.githubusercontent.com/*)
      return 0
      ;;
    https://github.com/*/raw/*|http://github.com/*/raw/*)
      return 0
      ;;
  esac

  local clean="${url%%[\?#]*}"
  case "$clean" in
    *.md|*.markdown|*.mdx|*.txt|*.rst|*.adoc|\
    *.js|*.jsx|*.ts|*.tsx|*.mjs|*.cjs|\
    *.json|*.jsonc|*.yaml|*.yml|*.toml|*.xml|\
    *.css|*.scss|*.sass|*.less|*.html|*.htm|\
    *.py|*.rb|*.go|*.rs|*.java|*.kt|*.kts|*.swift|\
    *.c|*.h|*.cc|*.cpp|*.cxx|*.hpp|*.cs|\
    *.sh|*.bash|*.zsh|*.fish|*.ps1|\
    *.sql|*.graphql|*.gql|*.proto|*.dockerfile|*/Dockerfile)
      return 0
      ;;
  esac

  return 1
}

while IFS= read -r url; do
  if [[ -n "$url" ]] && ! is_allowed_curl_file_url "$url"; then
    block "curl is not allowed for agent web lookups." \
          "Direct markdown/code file URLs are allowed; use WebSearch/WebFetch or an approved browser tool for webpages."
  fi
done < <(
  printf '%s\n' "$SCAN" |
    grep -E '(^|[;&|[:space:]])(command[[:space:]]+)?curl([[:space:]]|$)' |
    grep -Eo 'https?://[^[:space:];|&<>"'\''`)]+' || true
)

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
