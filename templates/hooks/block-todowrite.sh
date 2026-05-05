#!/usr/bin/env bash
# PreToolUse hook for TodoWrite — blocks it and redirects to beads.
set -euo pipefail

echo "⛔ TodoWrite is blocked. Use beads instead:" >&2
echo "" >&2
echo "   bd create <title>     — create an issue" >&2
echo "   bd update <id>        — update an issue" >&2
echo "   bd ready              — find available work" >&2
echo "   bd show <id>          — view issue details" >&2
echo "   bd close <id>         — complete work" >&2
echo "" >&2
echo "Run 'bd prime' for the full workflow reference." >&2
exit 2
