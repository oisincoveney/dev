#!/usr/bin/env bash
# Stop hook — blocks responses that cite external documentation
# ("according to", "the docs say", etc.) without an actual WebFetch
# or Context7 lookup in the session transcript.
#
# Skipped when the cited library appears in package.json (in-tree code
# is ground truth, not external docs).
#
# Fail-open on parse errors.
set -euo pipefail

INPUT=$(cat)
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null || echo "")
CWD=$(echo "$INPUT" | jq -r '.cwd // "."' 2>/dev/null || echo ".")

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

if ! echo "$LAST_MSG" | grep -qiE '(according to|per the docs|the docs (say|state)|the spec (says|states)|the (RFC|standard) (says|states))'; then
  exit 0
fi

WEB_FETCH_USED=$(jq -r '
  (
    if .type == "tool_use" and (.name == "WebFetch" or .name == "WebSearch" or (.name | test("context7"; "i"))) then .name
    elif .type == "assistant" or .role == "assistant" then
      if (.content | type) == "array" then
        (.content[] | select(.type == "tool_use" and (.name == "WebFetch" or .name == "WebSearch" or (.name | test("context7"; "i")))) | .name) // empty
      elif (.message.content | type) == "array" then
        (.message.content[] | select(.type == "tool_use" and (.name == "WebFetch" or .name == "WebSearch" or (.name | test("context7"; "i")))) | .name) // empty
      else empty
      end
    else empty
    end
  ) | select(. != null and . != "")
' "$TRANSCRIPT" 2>/dev/null | head -1 || true)

if [[ -n "$WEB_FETCH_USED" ]]; then
  exit 0
fi

DEPS=""
if [[ -f "$CWD/package.json" ]]; then
  DEPS=$(jq -r '(.dependencies // {}) + (.devDependencies // {}) | keys | join(" ")' "$CWD/package.json" 2>/dev/null || echo "")
fi

if [[ -n "$DEPS" ]]; then
  for dep in $DEPS; do
    if echo "$LAST_MSG" | grep -qiF -- "$dep"; then
      exit 0
    fi
  done
fi

echo "" >&2
echo "⛔ Cited external docs without a WebFetch / Context7 lookup this session." >&2
echo "" >&2
echo "   Phrases like \"according to\" / \"the docs say\" / \"the spec says\" require" >&2
echo "   evidence — either a WebFetch in the transcript or a Context7 MCP call." >&2
echo "   None was found." >&2
echo "" >&2
echo "   Either:" >&2
echo "     - Run WebFetch on the official docs and quote the passage, or" >&2
echo "     - Remove the citation language and state the claim as your own opinion." >&2
exit 2
