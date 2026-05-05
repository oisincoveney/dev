#!/usr/bin/env bash
# SessionStart hook — injects per-session static context.
#
# Static-per-session: communication mode, project metadata, commands, deps.
# Dynamic per-turn state (branch) lives in UserPromptSubmit hook.
# bd ready queue handled by beads marketplace plugin's own SessionStart hook.
#
# Layout: cache-friendly static content first (caveman + project), mutable
# content (deps) last. Maximizes Anthropic prompt-cache hit across sessions.
set -euo pipefail

CONFIG_FILE=".dev.config.json"

# Communication mode — caveman (full) inlined. Skips Skill round-trip and
# replaces the now-retired communication-style.md rule. Off switch:
# "stop caveman" / "normal mode".
read -r -d '' caveman_mode <<'CAVEMAN' || true
COMMUNICATION MODE — caveman (full). Active every response this session unless user says "stop caveman" or "normal mode".

Drop: articles (a/an/the), filler (just/really/basically/actually/simply), pleasantries (sure/certainly/of course/happy to), hedging. Fragments OK. Short synonyms (big not extensive, fix not "implement a solution"). Technical terms exact. Code blocks unchanged. Errors quoted exact.

Pattern: [thing] [action] [reason]. [next step].

Drop caveman temporarily for: security warnings, irreversible action confirmations, multi-step sequences where order is ambiguous, user clarification requests. Resume after clear part done.

Code/commits/PRs: write normal. Caveman applies to user-facing text only.
CAVEMAN

context="$caveman_mode"

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

  context="$context

$project_info"

  # Dependency inventory — pre-empts the import-validator hook by giving
  # Claude the dep list before it writes a fabricated import. Goes last
  # because dep lists change more often than commands/metadata.
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
    context="$context

Installed dependencies: $deps
Do not import packages not in this list — import-validator hook blocks fabricated imports."
  fi
fi

jq -n --arg ctx "$context" '{
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: $ctx
  }
}'
