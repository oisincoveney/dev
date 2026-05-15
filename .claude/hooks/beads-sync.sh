#!/usr/bin/env bash
set -euo pipefail

# Lefthook Git-boundary sync for Beads/Dolt state.
# Normal bd commands intentionally do not auto-sync; the harness owns sync at
# commit/push/checkout/merge boundaries instead.

MODE="${1:-}"
case "$MODE" in
  pull|pull-best-effort|push|push-best-effort) ;;
  *)
    echo "usage: beads-sync.sh pull|pull-best-effort|push|push-best-effort" >&2
    exit 2
    ;;
esac

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

if [[ ! -d .beads ]] || ! command -v bd >/dev/null 2>&1; then
  exit 0
fi

export GIT_TERMINAL_PROMPT=0
export GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -o BatchMode=yes}"

# bd dolt push/pull shells out to git inside Dolt's bare git-remote-cache.
# Do not let global/repo hooks recurse back into this sync hook from there.
GIT_CONFIG_INDEX="${GIT_CONFIG_COUNT:-0}"
if [[ ! "$GIT_CONFIG_INDEX" =~ ^[0-9]+$ ]]; then
  GIT_CONFIG_INDEX=0
fi
export "GIT_CONFIG_KEY_${GIT_CONFIG_INDEX}=core.hooksPath"
export "GIT_CONFIG_VALUE_${GIT_CONFIG_INDEX}=/dev/null"
export GIT_CONFIG_COUNT=$((GIT_CONFIG_INDEX + 1))

LOCK_DIR=".beads/.oisin-dev-sync.lock"
LOCKED=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    LOCKED=1
    break
  fi
  sleep 1
done

if [[ "$LOCKED" != 1 ]]; then
  echo "beads sync: another bd sync is still running" >&2
  case "$MODE" in
    *best-effort) exit 0 ;;
    *) exit 1 ;;
  esac
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

run_bounded() {
  local seconds="$1"
  shift

  "$@" &
  local cmd_pid=$!

  (
    sleep "$seconds"
    kill -TERM "$cmd_pid" 2>/dev/null || true
    sleep 1
    kill -KILL "$cmd_pid" 2>/dev/null || true
  ) &
  local killer_pid=$!

  local status=0
  wait "$cmd_pid" 2>/dev/null || status=$?
  kill "$killer_pid" 2>/dev/null || true
  wait "$killer_pid" 2>/dev/null || true
  return "$status"
}

TIMEOUT="${OISIN_DEV_BEADS_SYNC_TIMEOUT:-30}"

case "$MODE" in
  pull|pull-best-effort)
    if run_bounded "$TIMEOUT" bd --sandbox dolt pull; then
      exit 0
    fi
    echo "beads sync: bd dolt pull failed or timed out" >&2
    ;;
  push|push-best-effort)
    if run_bounded "$TIMEOUT" bd --sandbox dolt push; then
      exit 0
    fi
    echo "beads sync: bd dolt push failed or timed out" >&2
    ;;
esac

case "$MODE" in
  *best-effort) exit 0 ;;
  *) exit 1 ;;
esac
