#!/usr/bin/env bash
# Stop hook — compares current failing-test set against the baseline
# pinned by baseline-pin.sh. Exits 2 if any test fails now that did not
# fail in the baseline; the message lists the regression delta.
#
# Fail-open on missing baseline, parse errors, or test-runner failures.
set -euo pipefail

INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // "."' 2>/dev/null || echo ".")
CONFIG="$CWD/.dev.config.json"
BASELINE="$CWD/.claude/baseline-failures.json"

[[ ! -f "$BASELINE" || ! -f "$CONFIG" ]] && exit 0

SKIPPED=$(jq -r '.skipped // false' "$BASELINE" 2>/dev/null || echo "true")
[[ "$SKIPPED" == "true" ]] && exit 0

TEST_CMD=$(jq -r '.commands.test // empty' "$CONFIG" 2>/dev/null || echo "")
[[ -z "$TEST_CMD" || "$TEST_CMD" == "null" ]] && exit 0

cd "$CWD"

set +e
TEST_OUTPUT=$(eval "$TEST_CMD" 2>&1)
TEST_EXIT=$?
set -e

[[ $TEST_EXIT -eq 0 ]] && exit 0

CURRENT_FAILING=$(printf '%s\n' "$TEST_OUTPUT" | grep -E '^[[:space:]]*(FAIL|✗|✘|×)[[:space:]]+' | sed -E 's/^[[:space:]]*(FAIL|✗|✘|×)[[:space:]]+//' | sort -u || true)
[[ -z "$CURRENT_FAILING" ]] && exit 0

BASELINE_FAILING=$(jq -r '.failing[]?' "$BASELINE" 2>/dev/null | sort -u || true)

REGRESSIONS=$(comm -23 <(printf '%s\n' "$CURRENT_FAILING") <(printf '%s\n' "$BASELINE_FAILING") || true)

[[ -z "$REGRESSIONS" ]] && exit 0

echo "" >&2
echo "⛔ Test regressions vs. baseline." >&2
echo "" >&2
echo "   Tests failing now that were NOT failing at session-start baseline:" >&2
echo "" >&2
printf '%s\n' "$REGRESSIONS" | sed 's/^/     - /' >&2
echo "" >&2
echo "   Fix the regressions or explicitly accept them. Calling these" >&2
echo "   'pre-existing' is wrong — the baseline says otherwise." >&2
exit 2
