#!/usr/bin/env bash
# PreToolUse hook for Write|Edit — blocks known AI anti-patterns:
# 1. Test deletion to make things pass
# 2. Exception suppression
# 3. Silent stub replacement (replacing real code with todo!/Not implemented)
#
# Based on DAPLab Columbia 2026 research on AI coding agent failure modes.
set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.filePath // empty' 2>/dev/null)
CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // .tool_input.new_string // .tool_input.newString // empty' 2>/dev/null)

if [[ -z "$FILE_PATH" || -z "$CONTENT" ]]; then
  exit 0
fi

block() {
  echo "⛔ AI anti-pattern detected in $FILE_PATH:" >&2
  echo "   $1" >&2
  echo "$2" >&2
  exit 2
}

# 1. Exception suppression patterns
if echo "$CONTENT" | grep -qE '^[[:space:]]*except[[:space:]]*:[[:space:]]*(pass|None)?$'; then
  block "Bare 'except:' clause (exception suppression)" \
        "Catch specific exception types and handle or re-raise them."
fi

if echo "$CONTENT" | grep -qE 'catch[[:space:]]*\([[:space:]]*_[[:space:]]*\)[[:space:]]*\{[[:space:]]*\}'; then
  block "Empty catch block 'catch (_) {}' (exception suppression)" \
        "Handle the error or let it propagate."
fi

# 2. Silent stubs
if echo "$CONTENT" | grep -qE 'throw new Error\("Not implemented"\)|throw new Error\("TODO'; then
  case "$FILE_PATH" in
    *.test.*|*.spec.*) ;;  # tests can have stubs
    *)
      block "Stub 'Not implemented' in production code" \
            "Either implement it or mark as a beads issue: bd create '<description>'"
      ;;
  esac
fi

if echo "$CONTENT" | grep -qE 'todo!\(\)|unimplemented!\(\)'; then
  case "$FILE_PATH" in
    */tests/*|*test*) ;;  # tests can have stubs
    *)
      block "Rust 'todo!()' or 'unimplemented!()' in production code" \
            "Either implement it or mark as a beads issue."
      ;;
  esac
fi

if echo "$CONTENT" | grep -qE 'panic\("TODO"\)|panic\("not implemented"\)|errors\.New\("not implemented"\)'; then
  case "$FILE_PATH" in
    *_test.go) ;;  # tests can have stubs
    *)
      block "Go stub panic/error in production code" \
            "Either implement it or mark as a beads issue."
      ;;
  esac
fi

exit 0
