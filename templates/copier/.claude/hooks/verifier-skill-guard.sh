#!/usr/bin/env bash
# Stop hook — proof of *skill-driven* verification.
#
# `pre-stop-verification.sh` checks that the test command was run.
# This hook checks that *review skills* were applied. When the agent
# claims completion (or runs `bd close`) after editing files in this
# session, it must have either:
#
#   (a) Spawned a fresh-context verifier — Skill spec-verifier OR
#       Agent subagent whose prompt references spec-verifier /
#       verifier-loop, OR
#   (b) Invoked the per-language review skills directly via the
#       Skill tool: always `code-review`, plus a language-specific
#       skill matching the file extensions edited this session.
#
# Without one of those paths, the agent has self-reviewed instead
# of delegating to the proper skills — the exact failure mode this
# guard exists to prevent.
#
# Exit 0 = allow stop
# Exit 2 = block stop with directive listing missing skills.
set -euo pipefail

INPUT=$(cat)
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null || true)

[[ -z "$TRANSCRIPT" || ! -f "$TRANSCRIPT" ]] && exit 0

# ── Detect completion-claim language in the last assistant message ──────────
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

CLAIMS_DONE=false
if [[ -n "$LAST_MSG" ]] && echo "$LAST_MSG" | grep -qiE \
  '(this (is |now |all )?(done|works?|working|complete|finished|ready))|(should work( now)?\.?$)|(all tests? (pass(es)?|are (green|passing)))|(task (is |now )?complete)|(implementation (is |now )?complete)|(everything (is |now )?working)|(the (changes?|fix|refactor) (is |are |now )?(done|complete|working))'; then
  CLAIMS_DONE=true
fi

# ── Detect `bd close` Bash invocation anywhere in the session ───────────────
BASH_COMMANDS=$(jq -r '
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
' "$TRANSCRIPT" 2>/dev/null || true)

BD_CLOSE_RAN=false
if [[ -n "$BASH_COMMANDS" ]] && echo "$BASH_COMMANDS" | grep -qE '(^|[^a-zA-Z0-9_-])bd[[:space:]]+close([[:space:]]|$)'; then
  BD_CLOSE_RAN=true
fi

# Neither claim nor close → nothing to gate.
if [[ "$CLAIMS_DONE" == "false" && "$BD_CLOSE_RAN" == "false" ]]; then
  exit 0
fi

# ── Files edited this session (Edit / Write tool calls) ────────────────────
EDITED_FILES=$(jq -r '
  (
    if .type == "tool_use" and (.name == "Edit" or .name == "Write") then .input.file_path // empty
    elif .type == "assistant" or .role == "assistant" then
      if (.content | type) == "array" then
        (.content[] | select(.type == "tool_use" and (.name == "Edit" or .name == "Write")) | .input.file_path) // empty
      elif (.message.content | type) == "array" then
        (.message.content[] | select(.type == "tool_use" and (.name == "Edit" or .name == "Write")) | .input.file_path) // empty
      else empty
      end
    else empty
    end
  ) | select(. != null and . != "")
' "$TRANSCRIPT" 2>/dev/null || true)

# If nothing was edited this session, there's no review surface to gate.
[[ -z "$EDITED_FILES" ]] && exit 0

# ── Map extensions → required language skills ──────────────────────────────
REQUIRED_LANG_SKILLS=()
if echo "$EDITED_FILES" | grep -qE '\.(ts|tsx|js|jsx|mjs|cjs)$'; then
  REQUIRED_LANG_SKILLS+=("typescript-advanced-types")
fi
if echo "$EDITED_FILES" | grep -qE '\.tsx?$'; then
  if echo "$EDITED_FILES" | grep -qE '(^|/)(app|pages)/'; then
    REQUIRED_LANG_SKILLS+=("nextjs-app-router-patterns")
  fi
fi
if echo "$EDITED_FILES" | grep -qE '\.go$'; then
  REQUIRED_LANG_SKILLS+=("golang-code-style")
  REQUIRED_LANG_SKILLS+=("golang-error-handling")
fi

REQUIRED_REVIEW_SKILLS=("code-review")

# ── Skill invocations in transcript ────────────────────────────────────────
SKILLS_INVOKED=$(jq -r '
  (
    if .type == "tool_use" and .name == "Skill" then .input.skill // empty
    elif .type == "assistant" or .role == "assistant" then
      if (.content | type) == "array" then
        (.content[] | select(.type == "tool_use" and .name == "Skill") | .input.skill) // empty
      elif (.message.content | type) == "array" then
        (.message.content[] | select(.type == "tool_use" and .name == "Skill") | .input.skill) // empty
      else empty
      end
    else empty
    end
  ) | select(. != null and . != "")
' "$TRANSCRIPT" 2>/dev/null || true)

# ── Verifier subagent path (Agent tool with spec-verifier in prompt) ───────
AGENT_PROMPTS=$(jq -r '
  (
    if .type == "tool_use" and .name == "Agent" then .input.prompt // empty
    elif .type == "assistant" or .role == "assistant" then
      if (.content | type) == "array" then
        (.content[] | select(.type == "tool_use" and .name == "Agent") | .input.prompt) // empty
      elif (.message.content | type) == "array" then
        (.message.content[] | select(.type == "tool_use" and .name == "Agent") | .input.prompt) // empty
      else empty
      end
    else empty
    end
  ) | select(. != null and . != "")
' "$TRANSCRIPT" 2>/dev/null || true)

VERIFIER_RAN=false
if [[ -n "$SKILLS_INVOKED" ]] && echo "$SKILLS_INVOKED" | grep -qE '^spec-verifier$'; then
  VERIFIER_RAN=true
fi
if [[ "$VERIFIER_RAN" == "false" && -n "$AGENT_PROMPTS" ]]; then
  if echo "$AGENT_PROMPTS" | grep -qiE 'spec-verifier|verifier-loop'; then
    VERIFIER_RAN=true
  fi
fi

if [[ "$VERIFIER_RAN" == "true" ]]; then
  exit 0
fi

# ── Otherwise: every required skill must have been invoked directly ────────
MISSING=()
for skill in "${REQUIRED_REVIEW_SKILLS[@]}" "${REQUIRED_LANG_SKILLS[@]}"; do
  if ! echo "$SKILLS_INVOKED" | grep -qE "^${skill}$"; then
    MISSING+=("$skill")
  fi
done

[[ ${#MISSING[@]} -eq 0 ]] && exit 0

echo "" >&2
echo "⛔ Verification skill(s) not invoked." >&2
echo "" >&2
echo "   You claimed completion (or ran 'bd close') after editing files," >&2
echo "   but didn't apply review skills. Either:" >&2
echo "" >&2
echo "   • Invoke the 'spec-verifier' skill, OR spawn an Agent whose" >&2
echo "     prompt references spec-verifier / verifier-loop, OR" >&2
echo "   • Invoke each of these skills directly via the Skill tool:" >&2
echo "" >&2
for skill in "${MISSING[@]}"; do
  echo "       - $skill" >&2
done
echo "" >&2
echo "   Self-review without these skills is the failure mode this guard" >&2
echo "   exists to prevent. See .claude/rules/verifier-loop.md." >&2
exit 2
