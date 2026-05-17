#!/usr/bin/env bash
# statusLine command — rendered in the Claude Code UI, zero token cost.
# One line: <variant> · <workflow> · branch · ready count
set -euo pipefail

parts=()
if [[ -f ".copier-answers.yml" ]]; then
  variant=$(awk -F': ' '/^variant:/ {print $2; exit}' .copier-answers.yml | tr -d '"' || true)
  workflow=$(awk -F': ' '/^workflow:/ {print $2; exit}' .copier-answers.yml | tr -d '"' || true)
  [[ -n "$variant" ]] && parts+=("$variant")
  [[ -n "$workflow" && "$workflow" != "none" ]] && parts+=("$workflow")
fi

branch=$(git branch --show-current 2>/dev/null || true)
[[ -n "$branch" ]] && parts+=("⎇ $branch")

backlog_ready_count() {
  local out_file
  local pid
  out_file=$(mktemp "${TMPDIR:-/tmp}/backlog-ready.XXXXXX") || return 0
  backlog task list -s "To Do" --plain >"$out_file" 2>/dev/null &
  pid=$!

  # Keep statusline cheap and non-blocking. statusLine runs frequently in the UI.
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid" 2>/dev/null || true
      grep -Ec '^[[:alpha:]][[:alnum:]_-]*-[0-9]+' "$out_file" 2>/dev/null || true
      rm -f "$out_file"
      return 0
    fi
    sleep 0.1
  done

  kill "$pid" 2>/dev/null || true
  sleep 0.1
  kill -KILL "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  rm -f "$out_file"
  return 0
}

if command -v backlog >/dev/null 2>&1; then
  ready_count=$(backlog_ready_count)
  if [[ -n "$ready_count" && "$ready_count" != "0" ]]; then
    parts+=("ready:$ready_count")
  fi
fi

# Bash ${arr[*]} joins with the first char of IFS only, so ' · ' would
# collapse to a space. Build the string manually.
out=""
for p in "${parts[@]}"; do
  if [[ -z "$out" ]]; then
    out="$p"
  else
    out="$out · $p"
  fi
done
printf '%s\n' "$out"
