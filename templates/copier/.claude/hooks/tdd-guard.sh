#!/usr/bin/env bash
# Lefthook pre-commit hook — enforces TDD discipline.
# If staged source files changed without corresponding test files, block.
set -euo pipefail

staged_source=$(git diff --cached --name-only --diff-filter=AM | grep -E '\.(ts|tsx|rs|go)$' | grep -vE '(\.test\.|\.spec\.|_test\.go$|/tests/)' || true)
staged_tests=$(git diff --cached --name-only --diff-filter=AM | grep -E '(\.test\.|\.spec\.|_test\.go$|/tests/)' || true)

if [[ -n "$staged_source" && -z "$staged_tests" ]]; then
  echo "⛔ TDD discipline: source files changed without corresponding test files." >&2
  echo "" >&2
  echo "Changed source files:" >&2
  echo "$staged_source" | sed 's/^/  - /' >&2
  echo "" >&2
  echo "Add tests first. If you genuinely have a reason to skip tests, bypass with --no-verify AND document why in the commit message." >&2
  exit 1
fi

exit 0
