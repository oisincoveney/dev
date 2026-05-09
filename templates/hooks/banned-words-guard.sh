#!/usr/bin/env bash
# Stop hook — blocks responses that contain user-banned words/phrases.
#
# Reads the banned list from .dev.config.json -> .bannedWords (array of strings).
# Each entry is matched as a case-insensitive whole word (\b...\b). Phrases with
# spaces are matched literally (case-insensitive).
#
# Exit 0 = allow stop
# Exit 2 = block stop with the offending entries listed to stderr
set -euo pipefail

INPUT=$(cat)
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null || true)
CWD=$(echo "$INPUT" | jq -r '.cwd // "."' 2>/dev/null || true)

CONFIG="$CWD/.dev.config.json"

[[ ! -f "$CONFIG" || -z "$TRANSCRIPT" || ! -f "$TRANSCRIPT" ]] && exit 0

# Read banned list. Missing or empty => no-op.
BANNED_COUNT=$(jq -r '(.bannedWords // []) | length' "$CONFIG" 2>/dev/null || echo 0)
[[ "$BANNED_COUNT" -eq 0 ]] && exit 0

# Extract last assistant message text (same approach as pre-stop-verification.sh).
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

# Walk banned entries and collect hits.
HITS=""
while IFS= read -r entry; do
  [[ -z "$entry" ]] && continue
  # Phrases (contain a space) match literally; single words match as \bword\b.
  if [[ "$entry" == *" "* ]]; then
    if echo "$LAST_MSG" | grep -qiF -- "$entry"; then
      HITS+="  - \"$entry\""$'\n'
    fi
  else
    # Escape regex metacharacters in the word before wrapping with word boundaries.
    escaped=$(printf '%s' "$entry" | sed 's/[][\.*^$/\\]/\\&/g')
    if echo "$LAST_MSG" | grep -qiE "\\b${escaped}\\b"; then
      HITS+="  - \"$entry\""$'\n'
    fi
  fi
done < <(jq -r '.bannedWords[]' "$CONFIG" 2>/dev/null)

[[ -z "$HITS" ]] && exit 0

echo "" >&2
echo "⛔ Banned word/phrase in response." >&2
echo "" >&2
echo "   The following entries from .dev.config.json -> bannedWords appeared" >&2
echo "   in your last message:" >&2
echo "" >&2
printf '%s' "$HITS" >&2
echo "" >&2
echo "   Rewrite the message without them." >&2
exit 2
