#!/usr/bin/env bash
# Stop hook — when running inside a parallel-tickets worker (cwd under
# .claude/worktrees/<name>/), block stop if the worker hasn't completed
# its lifecycle: uncommitted changes, unpushed commits, or a bd ticket
# still in_progress on its branch.
#
# Background: workers were terminating after spec-verifier returned, treating
# the verifier's "## Result: PASS" markdown as a return value and skipping
# steps 6-10 (close + commit + push + status). This hook forces the worker
# back into the loop until the worktree is clean.
#
# No-op outside worker contexts. Fail-open on missing tools.
set -euo pipefail

INPUT=$(cat)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || true)
[[ -z "$CWD" ]] && CWD="${PWD:-$(pwd)}"

# Only enforce inside a worktree.
case "$CWD" in
  */.claude/worktrees/*) ;;
  *) exit 0 ;;
esac

# Resolve worktree root.
WORKTREE_ROOT=$(printf '%s' "$CWD" | sed -E 's|(/.claude/worktrees/[^/]+).*|\1|')
[[ -z "$WORKTREE_ROOT" || ! -d "$WORKTREE_ROOT" ]] && exit 0

# All git commands run against the worktree, regardless of caller cwd.
GIT="git -C $WORKTREE_ROOT"

# Verify it's a git worktree before touching it.
$GIT rev-parse --git-dir >/dev/null 2>&1 || exit 0

REASONS=()

# Uncommitted changes?
if [[ -n "$($GIT status --porcelain 2>/dev/null || true)" ]]; then
  REASONS+=("uncommitted changes in $WORKTREE_ROOT")
fi

# Unpushed commits? Only checks if upstream is set; otherwise the branch
# was never pushed at all → that's its own failure mode.
UPSTREAM_OK=0
if $GIT rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
  UPSTREAM_OK=1
  if [[ -n "$($GIT log '@{u}..HEAD' --oneline 2>/dev/null || true)" ]]; then
    REASONS+=("unpushed commits on $($GIT branch --show-current 2>/dev/null || echo HEAD)")
  fi
fi

# If there are any commits at all but no upstream is set, the worker
# never ran `git push -u origin HEAD`.
if [[ "$UPSTREAM_OK" -eq 0 ]]; then
  if [[ -n "$($GIT log --oneline -1 2>/dev/null || true)" ]]; then
    # Distinguish a fresh worktree (HEAD == origin/HEAD) from one with
    # actual ticket commits. If HEAD differs from any remote ref we know
    # about, treat it as needing a push.
    HEAD_SHA=$($GIT rev-parse HEAD 2>/dev/null || true)
    REMOTE_HEAD=$($GIT rev-parse origin/HEAD 2>/dev/null || true)
    if [[ -n "$HEAD_SHA" && "$HEAD_SHA" != "$REMOTE_HEAD" ]]; then
      REASONS+=("branch has commits but no upstream — run: git push -u origin HEAD")
    fi
  fi
fi

# Any in_progress bd ticket? If bd is unavailable, skip this check.
if command -v bd >/dev/null 2>&1; then
  IN_PROGRESS=$(cd "$WORKTREE_ROOT" && bd list --status in_progress --json 2>/dev/null | jq -r '.[].id // empty' 2>/dev/null || true)
  if [[ -n "$IN_PROGRESS" ]]; then
    while IFS= read -r tid; do
      [[ -n "$tid" ]] && REASONS+=("bd ticket $tid still in_progress — close it or report FAIL")
    done <<< "$IN_PROGRESS"
  fi
fi

# All clean → allow stop.
[[ ${#REASONS[@]} -eq 0 ]] && exit 0

echo "" >&2
echo "⛔ Parallel-tickets worker stop blocked." >&2
echo "" >&2
echo "   Worktree: $WORKTREE_ROOT" >&2
echo "" >&2
echo "   You have not finished the worker lifecycle. Outstanding:" >&2
for reason in "${REASONS[@]}"; do
  echo "     - $reason" >&2
done
echo "" >&2
echo "   Steps 6-10 of the worker prompt MUST run before you stop:" >&2
echo "     6. spec-verifier (already done if you got here)" >&2
echo "     7. branch on result (PASS → bd close; FAIL → report)" >&2
echo "     8. git commit" >&2
echo "     9. git push -u origin HEAD" >&2
echo "    10. return one-line status to caller" >&2
echo "" >&2
echo "   The verifier's \"## Result:\" markdown is NOT your return value." >&2
echo "" >&2
exit 2
