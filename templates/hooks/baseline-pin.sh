#!/usr/bin/env bash
# SessionStart hook — pins the failing-test set on the merge-base of
# current branch and main. The Stop hook (baseline-compare.sh) compares
# current failures against this baseline and blocks Stop on regression.
#
# Fail-open philosophy: any infrastructure failure (missing test command,
# dirty tree, jq parse error, git failure) writes a `skipped` baseline so
# downstream comparison short-circuits. Never blocks Stop on its own errors.
set -euo pipefail

INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // "."' 2>/dev/null || echo ".")
CONFIG="$CWD/.dev.config.json"
BASELINE="$CWD/.claude/baseline-failures.json"

mkdir -p "$(dirname "$BASELINE")" 2>/dev/null || true

write_skipped() {
  local reason=$1
  jq -n --arg r "$reason" '{skipped: true, reason: $r}' >"$BASELINE" 2>/dev/null || \
    printf '{"skipped":true,"reason":"%s"}\n' "$reason" >"$BASELINE"
  exit 0
}

[[ ! -f "$CONFIG" ]] && write_skipped "no .dev.config.json"

TEST_CMD=$(jq -r '.commands.test // empty' "$CONFIG" 2>/dev/null || echo "")
[[ -z "$TEST_CMD" || "$TEST_CMD" == "null" ]] && write_skipped "no test command configured"

cd "$CWD"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  write_skipped "not a git repository"
fi

if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
  write_skipped "dirty checkout"
fi

CURRENT_REF=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [[ -z "$CURRENT_REF" || "$CURRENT_REF" == "HEAD" ]]; then
  CURRENT_REF=$(git rev-parse HEAD 2>/dev/null || "")
fi
[[ -z "$CURRENT_REF" ]] && write_skipped "cannot resolve current ref"

MAIN_REF="main"
git rev-parse --verify "$MAIN_REF" >/dev/null 2>&1 || MAIN_REF="master"
git rev-parse --verify "$MAIN_REF" >/dev/null 2>&1 || write_skipped "no main/master branch"

MERGE_BASE=$(git merge-base "$CURRENT_REF" "$MAIN_REF" 2>/dev/null || echo "")
[[ -z "$MERGE_BASE" ]] && write_skipped "no merge-base with $MAIN_REF"

if [[ "$MERGE_BASE" == "$(git rev-parse "$CURRENT_REF")" ]]; then
  write_skipped "current ref is at merge-base; nothing to baseline against"
fi

ORIGINAL_REF="$CURRENT_REF"
trap 'git checkout --quiet "$ORIGINAL_REF" >/dev/null 2>&1 || true' EXIT

if ! git checkout --quiet "$MERGE_BASE" >/dev/null 2>&1; then
  write_skipped "checkout merge-base failed"
fi

set +e
TEST_OUTPUT=$(eval "$TEST_CMD" 2>&1)
TEST_EXIT=$?
set -e

FAILING=""
if [[ $TEST_EXIT -ne 0 ]]; then
  FAILING=$(printf '%s\n' "$TEST_OUTPUT" | grep -E '^[[:space:]]*(FAIL|✗|✘|×)[[:space:]]+' | sed -E 's/^[[:space:]]*(FAIL|✗|✘|×)[[:space:]]+//' | sort -u || true)
fi

if [[ -z "$FAILING" ]]; then
  jq -n '{skipped: false, failing: [], capturedAt: now}' >"$BASELINE"
else
  jq -n --argjson f "$(printf '%s\n' "$FAILING" | jq -R . | jq -s .)" \
    '{skipped: false, failing: $f, capturedAt: now}' >"$BASELINE"
fi

exit 0
