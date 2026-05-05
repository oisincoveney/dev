#!/usr/bin/env bash
# Stop hook — proof-of-work gate for completion claims.
#
# Reads the session transcript to detect if Claude is claiming completion
# ("this works", "done", "implementation complete", etc.) without having
# actually run the test command this session.
#
# TDD-safe: only triggers on completion claims, not on every stop.
# During the red phase ("I've written the failing test"), no claim is made
# and this hook exits 0.
#
# Exit 0 = allow stop
# Exit 2 = block stop (Claude sees stderr and must address it)
set -euo pipefail

INPUT=$(cat)
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null || true)
CWD=$(echo "$INPUT" | jq -r '.cwd // "."' 2>/dev/null || true)

CONFIG="$CWD/.dev.config.json"

# Fail open: if no config or transcript, don't block
[[ ! -f "$CONFIG" || -z "$TRANSCRIPT" || ! -f "$TRANSCRIPT" ]] && exit 0

TEST_CMD=$(jq -r '.commands.test // empty' "$CONFIG" 2>/dev/null || true)
[[ -z "$TEST_CMD" ]] && exit 0

# Extract the last assistant message text from the transcript JSONL.
# Try multiple formats defensively — the exact structure may vary.
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

# Check for completion-claim language in the last assistant message.
# Conservative patterns — must look like a terminal completion statement.
CLAIMS_DONE=false
if echo "$LAST_MSG" | grep -qiE \
  '(this (is |now |all )?(done|works?|working|complete|finished|ready))|
(should work( now)?\.?$)|
(all tests? (pass(es)?|are (green|passing)))|
(task (is |now )?complete)|
(implementation (is |now )?complete)|
(everything (is |now )?working)|
(the (changes?|fix|refactor) (is |are |now )?(done|complete|working))'; then
  CLAIMS_DONE=true
fi

[[ "$CLAIMS_DONE" == "false" ]] && exit 0

# Completion was claimed — verify the test command was actually run this session.
# Search transcript for Bash tool calls matching the configured test command.
TESTS_RAN=$(jq -r '
  (
    if .type == "tool_use" and .name == "Bash" then .input.command // empty
    elif .type == "assistant" or .role == "assistant" then
      if (.content | type) == "array" then
        (.content[] | select(.type == "tool_use" and .name == "Bash") | .input.command) // empty
      elif (.message.content | type) == "array" then
        (.message.content[] | select(.type == "tool_use" and .name == "Bash") | .input.command) // empty
      else empty
      end
    else empty
    end
  ) | select(. != null and . != "")
' "$TRANSCRIPT" 2>/dev/null | grep -F "$TEST_CMD" || true)

if [[ -z "$TESTS_RAN" ]]; then
  echo "" >&2
  echo "⛔ Proof of work required." >&2
  echo "" >&2
  echo "   You claimed completion but '${TEST_CMD}' was not run this session." >&2
  echo "" >&2
  echo "   Run:  ${TEST_CMD}" >&2
  echo "   Show the output. Then report done." >&2
  exit 2
fi

exit 0
