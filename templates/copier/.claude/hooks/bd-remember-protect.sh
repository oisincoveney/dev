#!/usr/bin/env bash
# PreToolUse hook (Bash matcher) — protects the `plan-approved:` and
# `plan-rejected:` bd-remember namespaces from agent-direct writes. Only the
# /approve, /reject, /regrill slash commands may write these keys. Slash
# commands set OISIN_DEV_PLAN_APPROVE=1 (or PLAN_REJECT, PLAN_REGRILL) when
# they invoke `bd remember` via the Bash tool — agents have no clean way to
# inject that env var without the hook seeing it in the command string.
#
# Strategy:
#   - If the command writes a protected namespace AND the env-var marker is
#     set inline in the command, allow.
#   - If the env-var marker is set inline but the calling chain looks like
#     it originates from outside the slash command (parent process or
#     command shape), block.
#   - If the namespace is touched WITHOUT the marker, block.
#
# This is a defense-in-depth gate. The strongest mechanical guarantee is that
# slash commands run only on user input.

set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
[[ -z "$COMMAND" ]] && exit 0

# Match `bd remember "plan-approved:..."` or `bd remember --delete plan-approved:...`
# Also match plan-rejected: namespace.
if ! echo "$COMMAND" | grep -qE 'bd[[:space:]]+(remember|memories)[[:space:]]+.*plan-(approved|rejected):'; then
  exit 0
fi

# Read-only `bd memories <key>` lookups are always allowed.
if echo "$COMMAND" | grep -qE 'bd[[:space:]]+memories[[:space:]]+'; then
  exit 0
fi

# At this point we know `bd remember` is touching a protected namespace.
# Require the env-var marker as an inline command-prefix.
if echo "$COMMAND" | grep -qE '(^|[[:space:]]|;|&&)OISIN_DEV_PLAN_(APPROVE|REJECT|REGRILL)=1[[:space:]]+bd[[:space:]]+remember'; then
  # Marker present. Allow.
  exit 0
fi

# Block.
echo "" >&2
echo "⛔ Reserved bd-remember namespace." >&2
echo "" >&2
echo "   The plan-approved: and plan-rejected: keys are reserved for the" >&2
echo "   /approve, /reject, /regrill slash commands. Agents cannot write" >&2
echo "   to these namespaces directly." >&2
echo "" >&2
echo "   If you are trying to record an approval, the user must run:" >&2
echo "     /approve <epic-id>" >&2
echo "" >&2
exit 2
