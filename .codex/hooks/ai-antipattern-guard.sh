#!/usr/bin/env bash
# PreToolUse / PostToolUse / Stop hook for Write|Edit — blocks known
# AI anti-patterns: exception suppression, silent stubs, swallowed
# errors, placeholder values, TODO-as-implementation.
#
# Based on DAPLab Columbia 2026 research on AI coding agent failure
# modes plus practitioner reports of common bandaid fixes.
set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.filePath // empty' 2>/dev/null)
CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // .tool_input.new_string // .tool_input.newString // empty' 2>/dev/null)

if [[ -z "$FILE_PATH" || -z "$CONTENT" ]]; then
  exit 0
fi

is_test_file() {
  case "$FILE_PATH" in
    *.test.*|*.spec.*|*_test.go) return 0 ;;
    */tests/*|*/__tests__/*) return 0 ;;
    *) return 1 ;;
  esac
}

block() {
  echo "⛔ AI anti-pattern detected in $FILE_PATH:" >&2
  echo "   $1" >&2
  echo "$2" >&2
  exit 2
}

# 1. Exception suppression
if echo "$CONTENT" | grep -qE '^[[:space:]]*except[[:space:]]*:[[:space:]]*(pass|None)?$'; then
  block "Bare except clause (exception suppression)" \
        "Catch specific exception types and handle or re-raise them."
fi

if echo "$CONTENT" | grep -qE 'catch[[:space:]]*\([[:space:]]*_[[:space:]]*\)[[:space:]]*\{[[:space:]]*\}'; then
  block "Empty single-underscore catch block (exception suppression)" \
        "Handle the error or let it propagate."
fi

# 2. Silent stubs
if echo "$CONTENT" | grep -qE 'throw new Error\("Not implemented"\)|throw new Error\("TODO'; then
  if ! is_test_file; then
    block "Stub 'Not implemented' in production code" \
          "Either implement it or file a bd issue: bd create '<description>'"
  fi
fi

if echo "$CONTENT" | grep -qE 'todo!\(\)|unimplemented!\(\)'; then
  if ! is_test_file; then
    block "Rust todo macro or unimplemented macro in production code" \
          "Either implement it or file a bd issue: bd create '<description>'"
  fi
fi

if echo "$CONTENT" | grep -qE 'panic\("TODO"\)|panic\("not implemented"\)|errors\.New\("not implemented"\)'; then
  if ! is_test_file; then
    block "Go stub panic or sentinel error in production code" \
          "Either implement it or file a bd issue: bd create '<description>'"
  fi
fi

# 3. Swallowed errors via try/catch returning null or empty container
if ! is_test_file; then
  if echo "$CONTENT" | grep -qE 'catch[[:space:]]*\([^)]*\)[[:space:]]*\{[[:space:]]*return[[:space:]]+(null|\[\]|\{\})[[:space:]]*;?[[:space:]]*\}'; then
    block "catch block returns null or empty container (swallowed error)" \
          "Either propagate the error, log + rethrow, or document why empty is correct."
  fi
fi

# 4. TODO-implement / FIXME-implement comments in production code
if ! is_test_file; then
  if echo "$CONTENT" | grep -qiE '//[[:space:]]*(TODO|FIXME)[[:space:]]*:?[[:space:]]*implement\b'; then
    block "// TODO: implement comment in production code" \
          "Either implement it or file a bd issue: bd create '<description>'"
  fi
fi

# 5. Placeholder string literals in production code (TS/JS only — Rust/Go test
# fixtures often legitimately use 'foo' as a name in non-test code).
if ! is_test_file; then
  case "$FILE_PATH" in
    *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs)
      if echo "$CONTENT" | grep -qE '"(replaceme|REPLACEME)"'; then
        block "Placeholder string 'replaceme' in production code" \
              "Replace with the real value or extract to config."
      fi
      ;;
  esac
fi

exit 0
