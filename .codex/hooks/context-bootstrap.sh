#!/usr/bin/env bash
# SessionStart hook — injects one-shot project context that stays in-session.
#
# Carries the static-per-session bits (project type, commands, dependency
# list, bd ready queue). Dynamic per-turn state (branch, current task) lives
# in the UserPromptSubmit hook instead. The static payload used to be re-
# emitted on every prompt before v0.4.1 — that was a token tax.
set -euo pipefail

CONFIG_FILE=".dev.config.json"

# Always-on: force using-superpowers as the first action.
context="IMPORTANT: Your FIRST action this session must be to invoke the using-superpowers skill via the Skill tool, before responding to the user or taking any other action."

if [[ -f "$CONFIG_FILE" ]]; then
  language=$(jq -r '.language // empty' "$CONFIG_FILE")
  variant=$(jq -r '.variant // empty' "$CONFIG_FILE")
  workflow=$(jq -r '.workflow // empty' "$CONFIG_FILE")
  dev=$(jq -r '.commands.dev // empty' "$CONFIG_FILE")
  build=$(jq -r '.commands.build // empty' "$CONFIG_FILE")
  test_cmd=$(jq -r '.commands.test // empty' "$CONFIG_FILE")
  typecheck=$(jq -r '.commands.typecheck // empty' "$CONFIG_FILE")
  lint=$(jq -r '.commands.lint // empty' "$CONFIG_FILE")
  format=$(jq -r '.commands.format // empty' "$CONFIG_FILE")

  project_info="Project: $variant ($language) | workflow: $workflow

Commands (use these exact strings — do not guess alternatives):
  dev:       $dev
  build:     $build
  test:      $test_cmd
  typecheck: $typecheck
  lint:      $lint
  format:    $format"

  # Dependency inventory — helps the import validator hook's negative case
  # (blocking fabricated imports) land before Claude writes a bad import.
  deps=""
  case "$language" in
    typescript)
      if [[ -f package.json ]]; then
        deps=$(jq -r '(.dependencies // {}) + (.devDependencies // {}) | keys | join(", ")' package.json 2>/dev/null || echo "")
      fi
      ;;
    rust)
      if [[ -f Cargo.toml ]]; then
        deps=$(grep -E '^[a-z_][a-z0-9_-]*[[:space:]]*=' Cargo.toml 2>/dev/null | awk '{print $1}' | tr '\n' ', ' | sed 's/,$//' || echo "")
      fi
      ;;
    go)
      if [[ -f go.mod ]]; then
        deps=$(grep -oE '[a-z0-9./_-]+ v[0-9][^ ]*' go.mod 2>/dev/null | awk '{print $1}' | tr '\n' ', ' | sed 's/,$//' || echo "")
      fi
      ;;
  esac
  if [[ -n "$deps" ]]; then
    project_info="$project_info

Installed dependencies: $deps
Do not import packages that are not in this list — the import validator hook will block fabricated imports."
  fi

  if command -v bd >/dev/null 2>&1; then
    ready=$(bd ready 2>/dev/null | head -5 || echo "(bd not initialized or no ready work)")
    project_info="$project_info

Beads ready queue:
$ready"
  fi

  context="$context

$project_info"
fi

jq -n --arg ctx "$context" '{
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: $ctx
  }
}'
