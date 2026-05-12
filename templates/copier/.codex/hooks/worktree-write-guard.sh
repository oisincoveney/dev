#!/usr/bin/env bash
# PreToolUse hook for Write|Edit — when running inside a parallel-tickets
# worker (cwd under .claude/worktrees/<name>/), block any write whose
# absolute path escapes that worktree root.
#
# Background: parallel-tickets spawns sub-agents with isolation: "worktree",
# placing them under .claude/worktrees/agent-XXX/. Workers that issue
# absolute-path writes to /Users/.../<project>/... resolve to the main
# checkout, not the worktree, silently corrupting state. This hook makes
# that physically impossible.
#
# No-op outside worker contexts (orchestrator, normal serial work).
# Fail-open if jq missing or input malformed.
set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.filePath // empty' 2>/dev/null || true)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || true)

# No file path → nothing to check
[[ -z "$FILE_PATH" ]] && exit 0

# Determine cwd: prefer hook-provided cwd, fall back to PWD.
[[ -z "$CWD" ]] && CWD="${PWD:-$(pwd)}"

# Only enforce when we're inside a worktree directory. The worktree
# convention is .claude/worktrees/<name>/ at the project root.
case "$CWD" in
  */.claude/worktrees/*) ;;
  *) exit 0 ;;
esac

# Compute the worktree root: everything up to and including the
# .claude/worktrees/<name> segment. Anything written outside that root
# leaks into the main checkout.
WORKTREE_ROOT=$(printf '%s' "$CWD" | sed -E 's|(/.claude/worktrees/[^/]+).*|\1|')

# Defensive: the case-match above guarantees `.claude/worktrees/` is
# present, but if the regex somehow didn't reduce the path, fail open.
case "$WORKTREE_ROOT" in
  */.claude/worktrees/*) ;;
  *) exit 0 ;;
esac

# Resolve FILE_PATH to an absolute path. Relative paths are interpreted
# against CWD (which is inside the worktree) so they're always safe.
case "$FILE_PATH" in
  /*) ABS_PATH="$FILE_PATH" ;;
  *)  exit 0 ;;
esac

# Allow writes anywhere under the worktree root.
case "$ABS_PATH" in
  "$WORKTREE_ROOT"/*|"$WORKTREE_ROOT") exit 0 ;;
esac

echo "" >&2
echo "⛔ Worktree write escape blocked." >&2
echo "" >&2
echo "   Worker is running in: $WORKTREE_ROOT" >&2
echo "   Tried to write to:    $ABS_PATH" >&2
echo "" >&2
echo "   Absolute paths from a parallel-tickets worker MUST stay under" >&2
echo "   the worktree root. Use a relative path, or rebuild the absolute" >&2
echo "   path against \$WORKTREE_ROOT." >&2
echo "" >&2
exit 2
