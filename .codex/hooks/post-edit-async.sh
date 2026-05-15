#!/usr/bin/env bash
# PostToolUse hook for Write|Edit — queues post-edit checks without blocking
# every edit. The worker coalesces rapid edits and records the latest result for
# post-edit-await.sh to enforce at Stop.
set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.filePath // empty' 2>/dev/null || true)
if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

case "$FILE_PATH" in
  *.ts|*.tsx|*.rs|*.go) ;;
  *) exit 0 ;;
esac

if [[ ! -f "mise.toml" ]]; then
  exit 0
fi

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
TARGET_DIR=$(basename "$(dirname "$SCRIPT_DIR")")
STATE_DIR="$PWD/$TARGET_DIR/hook-state/post-edit"
mkdir -p "$STATE_DIR"

SEQ=$(date +%s%N 2>/dev/null || date +%s)
printf '%s' "$INPUT" >"$STATE_DIR/latest-input.json.tmp"
mv "$STATE_DIR/latest-input.json.tmp" "$STATE_DIR/latest-input.json"
printf '%s\n' "$SEQ" >"$STATE_DIR/desired.seq.tmp"
mv "$STATE_DIR/desired.seq.tmp" "$STATE_DIR/desired.seq"

if [[ -f "$STATE_DIR/worker.pid" ]]; then
  PID=$(cat "$STATE_DIR/worker.pid" 2>/dev/null || true)
  if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
    exit 0
  fi
fi

(
  while true; do
    RUN_SEQ=$(cat "$STATE_DIR/desired.seq" 2>/dev/null || echo "$SEQ")
    cp "$STATE_DIR/latest-input.json" "$STATE_DIR/running-input.json" 2>/dev/null || exit 0

    set +e
    "$SCRIPT_DIR/post-edit-check.sh" <"$STATE_DIR/running-input.json" >"$STATE_DIR/stdout.tmp" 2>"$STATE_DIR/stderr.tmp"
    STATUS=$?
    set -e

    printf '%s\n' "$STATUS" >"$STATE_DIR/status.tmp"
    printf '%s\n' "$RUN_SEQ" >"$STATE_DIR/completed.seq.tmp"
    mv "$STATE_DIR/stdout.tmp" "$STATE_DIR/stdout"
    mv "$STATE_DIR/stderr.tmp" "$STATE_DIR/stderr"
    mv "$STATE_DIR/status.tmp" "$STATE_DIR/status"
    mv "$STATE_DIR/completed.seq.tmp" "$STATE_DIR/completed.seq"

    DESIRED_NOW=$(cat "$STATE_DIR/desired.seq" 2>/dev/null || echo "$RUN_SEQ")
    [[ "$DESIRED_NOW" == "$RUN_SEQ" ]] && break
  done
  rm -f "$STATE_DIR/worker.pid"
) </dev/null >/dev/null 2>&1 &

printf '%s\n' "$!" >"$STATE_DIR/worker.pid"
exit 0
