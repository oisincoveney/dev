#!/usr/bin/env bash
# Stop hook — always-on enforcement of grounding for factual claims.
#
# Two phases, gated by markers left in stderr (which the harness echoes back
# into the transcript as synthetic user content):
#
#   1. Gate:  if no grounding tool call (WebFetch, WebSearch, Read, Grep,
#             Glob, Bash) fired since the last real user message, block with
#             a "go do the research now" message.
#   2. Audit: if grounding calls exist but the audit marker is not in the
#             recent transcript, block with a checklist requiring each claim
#             to be cited against a specific tool call.
#
# Once the audit marker is seen in the recent transcript, exit 0.

set -euo pipefail

INPUT=$(cat)
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null || true)

[[ -z "$TRANSCRIPT" || ! -f "$TRANSCRIPT" ]] && exit 0

GATE_MARKER="VERIFY_GROUNDING_GATE_FIRED"
AUDIT_MARKER="VERIFY_GROUNDING_AUDIT_FIRED"

RECENT=$(tail -n 80 "$TRANSCRIPT" 2>/dev/null || true)

# Audit already ran this turn — pass through.
if echo "$RECENT" | grep -qF "$AUDIT_MARKER"; then
  exit 0
fi

# Emit one token per transcript event so we can walk in bash.
# USER resets the grounding count; TOOL:<name> increments it when the name
# matches a grounding tool.
TOKENS=$(jq -r '
  if (.type == "user" or .role == "user") then "USER"
  elif (.type == "tool_use") then "TOOL:\(.name // "")"
  elif (.type == "assistant" or .role == "assistant") then
    if (.content | type) == "array" then
      (.content[] | select(.type == "tool_use") | "TOOL:\(.name // "")")
    elif ((.message.content) | type) == "array" then
      (.message.content[] | select(.type == "tool_use") | "TOOL:\(.name // "")")
    else empty end
  else empty end
' "$TRANSCRIPT" 2>/dev/null || true)

GROUNDING=0
while IFS= read -r t; do
  case "$t" in
    USER) GROUNDING=0 ;;
    TOOL:WebFetch|TOOL:WebSearch|TOOL:Read|TOOL:Grep|TOOL:Glob|TOOL:Bash)
      GROUNDING=$((GROUNDING + 1)) ;;
  esac
done <<< "$TOKENS"

if [[ "$GROUNDING" -eq 0 ]]; then
  cat >&2 <<EOF

⛔ STOP. You produced a response without doing any research.

You did not call WebFetch, WebSearch, Read, Grep, Glob, or Bash this turn.
Everything in your response is pulled from training data — which is not
verification.

How do you know you're right? You don't. Go find out.

Go do the research now:
  - WebFetch against official docs for any library, framework, or API
    you referenced
  - Read the actual files in this project if you made claims about the code
  - Run the command via Bash if you made claims about its output

Then write your response. Do not respond until every claim is backed by
a tool call from this turn.

Marker: $GATE_MARKER
EOF
  exit 2
fi

cat >&2 <<EOF

⛔ STOP. Audit every factual claim against your tool calls.

"Probably" is not acceptable. "Based on my training" is not acceptable.
"I didn't check X" is not acceptable. "I think" is not acceptable.

For every factual claim in the message you just wrote:

  1. Name the claim.
  2. Cite the specific tool call from THIS turn that verifies it:
     - WebFetch against official docs
     - WebSearch for current behavior
     - Read of the actual file/line
     - Bash tool_result you can point at
  3. If you cannot cite a tool call for a claim: go get one now.
     Run the WebFetch. Read the file. Execute the command. Then continue.

Do not produce a response that contains unverified claims.
Do not produce a response that asks the user to accept unverified claims.
Go do the work, then respond.

Marker: $AUDIT_MARKER
EOF
exit 2
