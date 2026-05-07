#!/usr/bin/env bash
# Stop hook — waits for the queued post-edit check and surfaces its result.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
TARGET_DIR=$(basename "$(dirname "$SCRIPT_DIR")")
STATE_DIR="$PWD/$TARGET_DIR/hook-state/post-edit"
[[ ! -d "$STATE_DIR" ]] && exit 0

WAIT_SECONDS=${OISIN_DEV_POST_EDIT_WAIT_SECONDS:-120}
if [[ -f "$STATE_DIR/worker.pid" ]]; then
  PID=$(cat "$STATE_DIR/worker.pid" 2>/dev/null || true)
  if [[ -n "$PID" ]]; then
    DEADLINE=$((SECONDS + WAIT_SECONDS))
    while kill -0 "$PID" 2>/dev/null; do
      if (( SECONDS >= DEADLINE )); then
        echo "Post-edit check is still running after ${WAIT_SECONDS}s." >&2
        echo "Wait for it or run the configured typecheck/lint commands manually." >&2
        exit 2
      fi
      sleep 0.2
    done
  fi
fi

[[ ! -f "$STATE_DIR/status" ]] && exit 0
STATUS=$(cat "$STATE_DIR/status" 2>/dev/null || echo 0)
case "$STATUS" in
  0)
    exit 0
    ;;
  2)
    if [[ -s "$STATE_DIR/stderr" ]]; then
      cat "$STATE_DIR/stderr" >&2
    fi
    if [[ -s "$STATE_DIR/stdout" ]]; then
      cat "$STATE_DIR/stdout"
    fi
    exit 2
    ;;
  *)
    echo "Post-edit check failed unexpectedly with exit ${STATUS}." >&2
    if [[ -s "$STATE_DIR/stderr" ]]; then
      cat "$STATE_DIR/stderr" >&2
    fi
    exit 0
    ;;
esac
