#!/usr/bin/env bash
# PreToolUse hook for Write|Edit — validates imports against actual project deps.
# Catches hallucinated package imports before the file is written.
# Based on arXiv:2601.19106 — 100% precision on fabricated imports.
set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.filePath // empty' 2>/dev/null)
CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // .tool_input.new_string // .tool_input.newString // empty' 2>/dev/null)

if [[ -z "$FILE_PATH" || -z "$CONTENT" ]]; then
  exit 0
fi

# Resolve to absolute path so find_pkg_json walks up from the correct directory
if [[ "$FILE_PATH" != /* ]]; then
  FILE_PATH="$(pwd)/$FILE_PATH"
fi

fabricated=""

find_pkg_json() {
  local dir="$1"
  while [[ "$dir" != "/" && "$dir" != "." ]]; do
    if [[ -f "$dir/package.json" ]]; then
      echo "$dir/package.json"
      return
    fi
    dir="$(dirname "$dir")"
  done
  if [[ -f "package.json" ]]; then
    echo "package.json"
  fi
}

case "$FILE_PATH" in
  *.ts|*.tsx|*.js|*.mjs|*.cjs)
    _pkg_json=$(find_pkg_json "$(dirname "$FILE_PATH")")
    if [[ -n "$_pkg_json" && -f "$_pkg_json" ]]; then
      deps=$(jq -r '(.dependencies // {}) + (.devDependencies // {}) + (.peerDependencies // {}) | keys[]' "$_pkg_json" 2>/dev/null || echo "")
      imports=$(echo "$CONTENT" | grep -oE "from ['\"]([^'\"]+)['\"]|require\(['\"]([^'\"]+)['\"]\)" | sed -E "s/(from |require\()?['\"]([^'\"]+)['\"]\)?/\2/" | grep -v '^\.' | grep -v '^/' || true)
      for pkg in $imports; do
        base=$(echo "$pkg" | awk -F/ '{if ($1 ~ /^@/) print $1"/"$2; else print $1}')
        # Node built-ins and local path aliases (e.g. @/ Vite alias)
        case "$base" in
          fs|path|node:*|crypto|http|https|url|util|os|stream|events|child_process|buffer|assert|querystring|zlib|net|tls|dgram|dns|readline|repl|vm|worker_threads|cluster|perf_hooks|async_hooks|timers|string_decoder|console|process|module|v8|inspector|trace_events|wasi|test)
            continue
            ;;
        esac
        # Skip Vite/TypeScript path aliases like @/components, @/lib, @/store
        if [[ "$base" == "@/"* || "$pkg" == "@/"* ]]; then
          continue
        fi
        if ! echo "$deps" | grep -qxF "$base"; then
          fabricated+="$base\n"
        fi
      done
    fi
    ;;
  *.rs)
    if [[ -f Cargo.toml ]]; then
      deps=$(grep -E '^[a-z_][a-z0-9_-]*[[:space:]]*=' Cargo.toml 2>/dev/null | awk '{print $1}' || echo "")
      uses=$(echo "$CONTENT" | grep -oE 'use [a-z_][a-z0-9_]*' | awk '{print $2}' | sort -u || true)
      for crate in $uses; do
        case "$crate" in
          std|core|alloc|crate|self|super) continue ;;
        esac
        if ! echo "$deps" | grep -qxF "$crate"; then
          fabricated+="$crate\n"
        fi
      done
    fi
    ;;
  *.go)
    if [[ -f go.mod ]]; then
      deps=$(grep -oE '[a-z0-9./_-]+ v[0-9]' go.mod 2>/dev/null | awk '{print $1}' || echo "")
      imports=$(echo "$CONTENT" | grep -oE 'import[[:space:]]+"[^"]+"' | sed -E 's/import[[:space:]]+"([^"]+)"/\1/' || true)
      # Also handle import blocks
      for pkg in $imports; do
        # Standard library packages don't have dots
        if [[ "$pkg" != *.* ]]; then
          continue
        fi
        base=$(echo "$pkg" | awk -F/ '{print $1"/"$2"/"$3}' | sed 's|/$||')
        if ! echo "$deps" | grep -qF "$base"; then
          fabricated+="$pkg\n"
        fi
      done
    fi
    ;;
esac

if [[ -n "$fabricated" ]]; then
  echo "⛔ Fabricated imports detected in $FILE_PATH:" >&2
  echo -e "$fabricated" >&2
  echo "These packages are not in your project's dependencies." >&2
  echo "Either add them with your package manager, or use the actual installed API." >&2
  exit 2
fi

exit 0
