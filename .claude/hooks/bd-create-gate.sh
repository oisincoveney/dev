#!/usr/bin/env bash
# PreToolUse hook (Bash matcher) — validates `bd create` payloads against the
# ticket-shape rubric at .beads/ticket-rubric.json. Two modes:
#
#   1. epic-alone (`bd create --type=epic` without --graph) → epic_alone rules.
#   2. graph (`bd create --graph`) → epic_alone + task_in_graph + graph rules.
#
# Fail-open when:
#   - bd is not on PATH
#   - .beads/ticket-rubric.json is absent (consumer hasn't pulled the new templates)
#   - node is not on PATH (parser unusable)
#   - command is not a `bd create` invocation
#
# Bypass: `--gate-bypass` flag in the bd command. Logs to .beads/.gate-bypass.jsonl.

set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
[[ -z "$COMMAND" ]] && exit 0

# Match `bd create` only (after optional env-var assignments and leading whitespace).
if ! echo "$COMMAND" | grep -qE '(^|;|&&|\|\||\()[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*bd[[:space:]]+create\b'; then
  exit 0
fi

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
RUBRIC="$REPO_ROOT/.beads/ticket-rubric.json"
DSL_DIR="$REPO_ROOT/.beads/dsl"
[[ -f "$RUBRIC" ]] || exit 0
command -v bd >/dev/null 2>&1 || exit 0
command -v node >/dev/null 2>&1 || exit 0

# Bypass path: log and allow.
if echo "$COMMAND" | grep -qE -- '--gate-bypass\b'; then
  REASON=$(echo "$COMMAND" | grep -oE -- '--design[= ]"[^"]*"' | head -1 || echo '--design "(unspecified)"')
  printf '{"ts":"%s","cmd":%s,"reason":%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "$(printf '%s' "$COMMAND" | jq -Rs .)" \
    "$(printf '%s' "$REASON" | jq -Rs .)" \
    >> "$REPO_ROOT/.beads/.gate-bypass.jsonl"
  exit 0
fi

# Extract body. Two sources: --body-file=- (stdin heredoc inline), --body-file=<path>.
# Bash-native heredoc parser — portable across macOS BSD utils and Linux GNU.
extract_body() {
  local cmd="$1"
  if echo "$cmd" | grep -qE -- '--body-file=-'; then
    local in_h=0
    local tag=""
    local line
    while IFS= read -r line || [[ -n "$line" ]]; do
      if [[ $in_h -eq 0 ]]; then
        if [[ "$line" =~ \<\<[[:space:]]*[\'\"]*([A-Za-z_][A-Za-z0-9_]*)[\'\"]*[[:space:]]* ]]; then
          tag="${BASH_REMATCH[1]}"
          in_h=1
        fi
      else
        local trimmed="${line//[[:space:]]/}"
        if [[ "$trimmed" == "$tag" ]]; then
          in_h=2
        else
          printf '%s\n' "$line"
        fi
      fi
    done <<< "$cmd"
  elif path=$(echo "$cmd" | grep -oE -- '--body-file=[^ ]+' | head -1 | cut -d= -f2-); then
    [[ -n "$path" && "$path" != "-" && -f "$path" ]] && cat "$path"
  fi
}

# Detect graph mode (--graph flag).
IS_GRAPH=0
echo "$COMMAND" | grep -qE -- '--graph\b' && IS_GRAPH=1

# Determine type from --type=X flag.
TYPE=$(echo "$COMMAND" | grep -oE -- '--type=[a-z]+' | head -1 | cut -d= -f2 || echo "task")

BODY=$(extract_body "$COMMAND" || true)

# If graph mode but no body extractable, the payload is JSON (--graph /dev/stdin).
# We can't validate JSON-graph payloads in this minimal gate; warn and allow.
# Future: parse the JSON nodes and apply the rubric per-node.
if [[ "$IS_GRAPH" -eq 1 && -z "$BODY" ]]; then
  exit 0
fi

# Single-ticket validation against epic-alone or task rules.
if [[ -n "$BODY" ]]; then
  PARSE=$(printf '%s' "$BODY" | node "$DSL_DIR/parse.mjs" 2>/dev/null || echo '{}')

  HAS_FRONTMATTER=$(echo "$PARSE" | jq -r '.hasFrontmatter // false' 2>/dev/null || echo "false")

  if [[ "$HAS_FRONTMATTER" != "true" ]]; then
    # No DSL frontmatter — warn but allow (legacy ticket bodies).
    exit 0
  fi

  WORDS=$(echo "$PARSE" | jq -r '.body // ""' | wc -w | tr -d ' ')
  EPIC_LIMIT=$(jq -r '.limits.epic_body_max_words' "$RUBRIC")
  TASK_LIMIT=$(jq -r '.limits.task_body_max_words' "$RUBRIC")

  if [[ "$TYPE" == "epic" ]]; then
    DOMAIN=$(echo "$PARSE" | jq -r '.frontmatter.domain // ""')
    ARTIFACT=$(echo "$PARSE" | jq -r '.frontmatter.artifact // ""')
    OOS_COUNT=$(echo "$PARSE" | jq -r '.frontmatter.out_of_scope // [] | length')

    fail=0
    msgs=()
    if [[ -z "$DOMAIN" ]]; then
      msgs+=("epic.domain — must declare a single domain (e.g. 'auth.sso'). The domain field is the bundle-prevention contract.")
      fail=1
    fi
    if [[ -z "$ARTIFACT" ]]; then
      msgs+=("epic.artifact — must declare a single demoable artifact for the epic.")
      fail=1
    fi
    if [[ "$OOS_COUNT" -lt 1 ]]; then
      msgs+=("epic.out_of_scope — must list ≥1 out-of-scope item. Declaring what you're NOT doing prevents bundling.")
      fail=1
    fi
    if [[ "$WORDS" -gt "$EPIC_LIMIT" ]]; then
      msgs+=("epic.body_budget — body has $WORDS words, limit is $EPIC_LIMIT. Compress or move detail into children.")
      fail=1
    fi

    if [[ $fail -eq 1 ]]; then
      echo "" >&2
      echo "⛔ bd create blocked by ticket-rubric (epic-alone mode):" >&2
      echo "" >&2
      for m in "${msgs[@]}"; do
        echo "  • $m" >&2
      done
      echo "" >&2
      echo "  Fix the body, or run with --gate-bypass --design \"<reason>\" to log an exception." >&2
      echo "" >&2
      exit 2
    fi
  elif [[ "$TYPE" == "task" || "$TYPE" == "bug" ]]; then
    FILES_COUNT=$(echo "$PARSE" | jq -r '.frontmatter.files // [] | length')
    VERIFY_COUNT=$(echo "$PARSE" | jq -r '.frontmatter.verify // [] | length')
    AC_COUNT=$(echo "$PARSE" | jq -r '.frontmatter.ac // [] | length')

    fail=0
    msgs=()
    if [[ "$FILES_COUNT" -lt 1 ]]; then
      msgs+=("task.files — must list ≥1 file path under \`files\`. Empty files[] is the empty-molecule failure mode.")
      fail=1
    fi
    if [[ "$VERIFY_COUNT" -lt 1 ]]; then
      msgs+=("task.verify — must list ≥1 verification command under \`verify\`.")
      fail=1
    fi
    if [[ "$AC_COUNT" -lt 1 ]]; then
      msgs+=("task.ac — must list ≥1 acceptance criterion under \`ac\` (EARS form).")
      fail=1
    fi
    if [[ "$WORDS" -gt "$TASK_LIMIT" ]]; then
      msgs+=("task.body_budget — body has $WORDS words, limit is $TASK_LIMIT.")
      fail=1
    fi

    if [[ $fail -eq 1 ]]; then
      echo "" >&2
      echo "⛔ bd create blocked by ticket-rubric (task mode):" >&2
      echo "" >&2
      for m in "${msgs[@]}"; do
        echo "  • $m" >&2
      done
      echo "" >&2
      exit 2
    fi
  fi
fi

exit 0
