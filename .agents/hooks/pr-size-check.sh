#!/usr/bin/env bash
# Lefthook pre-push hook — PR size advisory.
set -euo pipefail

# Find the merge base with main/master
base=""
for candidate in origin/main origin/master main master; do
  if git rev-parse --verify "$candidate" >/dev/null 2>&1; then
    base=$candidate
    break
  fi
done

if [[ -z "$base" ]]; then
  exit 0
fi

lines=$(git diff --numstat "$base...HEAD" 2>/dev/null | awk '{add+=$1; del+=$2} END {print add+del}')
lines=${lines:-0}

if [[ "$lines" -gt 400 ]]; then
  echo "⚠️  PR size: $lines lines changed (advisory threshold: 400)" >&2
  echo "Consider planning smaller review units, or document why this branch should stay together." >&2
fi

exit 0
