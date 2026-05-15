#!/usr/bin/env bash
# Stop hook — compares current failing-test set against the baseline pinned by
# baseline-pin.sh when the agent tries to dismiss failing tests as already known.
# Exits 2 if any test fails now that did not fail in the baseline; the message
# lists the regression delta.
#
# Fail-open on missing baseline, parse errors, or test-runner failures.
set -euo pipefail

INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // "."' 2>/dev/null || echo ".")
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null || echo "")
BASELINE="$CWD/.claude/baseline-failures.json"

[[ ! -f "$BASELINE" || ! -f "$CWD/mise.toml" ]] && exit 0

SKIPPED=$(jq -r '.skipped // false' "$BASELINE" 2>/dev/null || echo "true")
[[ "$SKIPPED" == "true" ]] && exit 0

if ! grep -Eq '^[[:space:]]*(test[[:space:]]*=|\[tasks\.test\])' "$CWD/mise.toml"; then
  exit 0
fi
TEST_CMD="MISE_TRUSTED_CONFIG_PATHS=\"$CWD/mise.toml\" mise run --raw test"

# Running the full configured test command at every Stop made ordinary response
# finalization pay the full suite cost repeatedly. Keep the regression guard
# focused on its failure mode: blocking claims that failing tests are merely
# known/baseline/pre-existing. The proof-of-work Stop hook already enforces that
# completion claims run the configured test command.
[[ -z "$TRANSCRIPT" || ! -f "$TRANSCRIPT" ]] && exit 0

LAST_MSG=$(jq -r '
  if .type == "assistant" or .role == "assistant" then
    if (.content | type) == "array" then
      [.content[] | select(.type == "text") | .text] | join(" ")
    elif (.content | type) == "string" then
      .content
    elif (.message | type) == "object" then
      if ((.message.content) | type) == "array" then
        [.message.content[] | select(.type == "text") | .text] | join(" ")
      else
        .message.content // ""
      end
    else ""
    end
  else empty
  end
' "$TRANSCRIPT" 2>/dev/null | grep -v '^$' | tail -1 || true)

[[ -z "$LAST_MSG" ]] && exit 0

if ! echo "$LAST_MSG" | grep -qiE \
  '(baseline|known failures?|already failing|existing failures?|pre-existing|unrelated failing test|unrelated test failure|failing before|failed before|not from (this|these) changes?)'; then
  exit 0
fi

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
