#!/usr/bin/env bash
# Runs hook scripts without surfacing infrastructure failures to the agent UI.
#
# Contract:
#   - exit 0: pass stdout through, suppress stderr
#   - exit 2: pass stdout/stderr through and preserve blocking behavior
#   - other: log stdout/stderr/status, then exit 0
#
# This keeps policy blocks visible while preventing missing tools, transient bd
# failures, or parser drift from polluting every tool call.
set -uo pipefail

SCRIPTS=("$@")

if [[ ${#SCRIPTS[@]} -eq 0 ]]; then
  exit 0
fi

ROOT="${PWD:-$(pwd)}"
CASE_DIR=".claude"
case "${SCRIPTS[0]}" in
  .codex/*|*/.codex/*) CASE_DIR=".codex" ;;
esac

LOG_DIR="$ROOT/$CASE_DIR"
LOG_FILE="$LOG_DIR/hook-errors.log"

INPUT_FILE=$(mktemp "${TMPDIR:-/tmp}/hook-input.XXXXXX")
STDOUT_FILE=$(mktemp "${TMPDIR:-/tmp}/hook-stdout.XXXXXX")
STDERR_FILE=$(mktemp "${TMPDIR:-/tmp}/hook-stderr.XXXXXX")
PASS_STDOUT_FILE=$(mktemp "${TMPDIR:-/tmp}/hook-pass-stdout.XXXXXX")
BLOCK_STDOUT_FILE=$(mktemp "${TMPDIR:-/tmp}/hook-block-stdout.XXXXXX")
BLOCK_STDERR_FILE=$(mktemp "${TMPDIR:-/tmp}/hook-block-stderr.XXXXXX")
trap 'rm -f "$INPUT_FILE" "$STDOUT_FILE" "$STDERR_FILE" "$PASS_STDOUT_FILE" "$BLOCK_STDOUT_FILE" "$BLOCK_STDERR_FILE"' EXIT

cat >"$INPUT_FILE"

BLOCKED=0

for SCRIPT in "${SCRIPTS[@]}"; do
  if [[ -z "$SCRIPT" || ! -x "$SCRIPT" ]]; then
    continue
  fi

  : >"$STDOUT_FILE"
  : >"$STDERR_FILE"
  "$SCRIPT" <"$INPUT_FILE" >"$STDOUT_FILE" 2>"$STDERR_FILE"
  STATUS=$?

  case "$STATUS" in
    0)
      cat "$STDOUT_FILE" >>"$PASS_STDOUT_FILE"
      continue
      ;;
    2)
      BLOCKED=1
      cat "$STDOUT_FILE" >>"$BLOCK_STDOUT_FILE"
      cat "$STDERR_FILE" >>"$BLOCK_STDERR_FILE"
      continue
      ;;
  esac

  mkdir -p "$LOG_DIR" 2>/dev/null || continue
  {
    printf '%s status=%s script=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date)" "$STATUS" "$SCRIPT"
    if [[ -s "$STDOUT_FILE" ]]; then
      printf '%s\n' '--- stdout ---'
      sed -n '1,120p' "$STDOUT_FILE"
    fi
    if [[ -s "$STDERR_FILE" ]]; then
      printf '%s\n' '--- stderr ---'
      sed -n '1,120p' "$STDERR_FILE"
    fi
    printf '%s\n' '--- end ---'
  } >>"$LOG_FILE" 2>/dev/null || true
done

if [[ "$BLOCKED" -eq 1 ]]; then
  cat "$BLOCK_STDOUT_FILE"
  cat "$BLOCK_STDERR_FILE" >&2
  exit 2
fi

cat "$PASS_STDOUT_FILE"

exit 0
