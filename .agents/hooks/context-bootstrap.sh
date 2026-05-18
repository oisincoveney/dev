#!/usr/bin/env bash
# SessionStart hook — injects per-session static context.
#
# Static-per-session: communication mode, project metadata, commands, deps.
# Dynamic per-turn state (branch) lives in UserPromptSubmit hook.
#
# Layout: cache-friendly static content first (caveman + project), mutable
# content (deps) last. Maximizes Anthropic prompt-cache hit across sessions.
set -euo pipefail

# Communication mode — caveman (full) inlined. Skips Skill round-trip and
# replaces the now-retired communication-style.md rule. Off switch:
# "stop caveman" / "normal mode".
read -r -d '' caveman_mode <<'CAVEMAN' || true
COMMUNICATION MODE — caveman (full). Active every response this session unless user says "stop caveman" or "normal mode".

Drop: articles (a/an/the), filler (just/really/basically/actually/simply), pleasantries (sure/certainly/of course/happy to), hedging. Fragments OK. Short synonyms (big not extensive, fix not "implement a solution"). Technical terms exact. Code blocks unchanged. Errors quoted exact.

Pattern: [thing] [action] [reason]. [next step].

Drop caveman temporarily for: security warnings, irreversible action confirmations, multi-step sequences where order is ambiguous, user clarification requests. Resume after clear part done.

Code/commits/PRs: write normal. Caveman applies to user-facing text only.
Tracker workflow: Backlog.md task files are canonical. Store state in task status, priority, dependencies, plan, notes, AC, DoD, and final summary fields.
Intent gate: question means answer only; investigate/research means report only; /quick means Worktrunk quick worktree; /work-next or approved tracker work means Worktrunk implementation.
Research gate: official docs/web first; project source second; node_modules, vendored deps, generated/build files only last resort.
No terminal follow-up prompts. State result and stop unless blocked.
Spawned agents: include this communication mode in their prompt. Fresh agent may not inherit session context.
CAVEMAN

context="$caveman_mode"

if [[ -f ".agents-harness.json" || -f ".copier-answers.yml" || -f "mise.toml" ]]; then
  if [[ -f ".agents-harness.json" ]]; then
    language=$(jq -r '.language // ""' .agents-harness.json 2>/dev/null || true)
    variant=$(jq -r '.variant // ""' .agents-harness.json 2>/dev/null || true)
    workflow=$(jq -r '.workflow // ""' .agents-harness.json 2>/dev/null || true)
  else
    language=$(awk -F': ' '/^language:/ {print $2; exit}' .copier-answers.yml 2>/dev/null | tr -d '"' || true)
    variant=$(awk -F': ' '/^variant:/ {print $2; exit}' .copier-answers.yml 2>/dev/null | tr -d '"' || true)
    workflow=$(awk -F': ' '/^workflow:/ {print $2; exit}' .copier-answers.yml 2>/dev/null | tr -d '"' || true)
  fi
  dev="mise run dev"
  build="mise run build"
  test_cmd="mise run test"
  typecheck="mise run typecheck"
  lint="mise run lint"
  format="mise run format"
  worktree_setup="mise run worktree:setup"
  worktree_verify="mise run worktree:verify"
  worktree_teardown="mise run worktree:teardown"

  project_info="Project: $variant ($language) | workflow: $workflow

Commands (use these exact mise tasks — do not guess package-manager alternatives):
  dev:       $dev
  build:     $build
  test:      $test_cmd
  typecheck: $typecheck
  lint:      $lint
  format:    $format

Worktree policy:
  Agent implementation work, including /quick, must use Worktrunk worktrees under .agents/worktrees/.
  Full clones, scratch directories, /tmp, /private/tmp, and TMPDIR overrides are forbidden.
  setup:    $worktree_setup
  verify:   $worktree_verify
  teardown: $worktree_teardown"

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
