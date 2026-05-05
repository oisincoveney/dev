#!/usr/bin/env bash
# PreToolUse hook for Write|Edit — enforces TS/TSX style rules from CLAUDE.md.
# Pure shell, no external CLI dependency.
# Exit 0 = allow, Exit 2 = hard block.
set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.filePath // empty' 2>/dev/null)
CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // .tool_input.new_string // .tool_input.newString // empty' 2>/dev/null)

if [[ -z "$FILE_PATH" || -z "$CONTENT" ]]; then
  exit 0
fi

case "$FILE_PATH" in
  *.ts|*.tsx) ;;
  *) exit 0 ;;
esac

# Skip code-generation files — they contain patterns as strings, not actual usage
case "$FILE_PATH" in
  */generate/*.ts|*/generators/*.ts|*/templates/*.ts|*/.claude/hooks/*) exit 0 ;;
esac

block() {
  echo "⛔ Style violation in $FILE_PATH:" >&2
  echo "   Rule: $1" >&2
  echo "   Fix:  $2" >&2
  exit 2
}

warn() {
  echo "⚠️  Style warning in $FILE_PATH:" >&2
  echo "   Rule: $1" >&2
  echo "   Fix:  $2" >&2
}

# ── TypeScript Strictness ────────────────────────────────────────────────────

# No `any` type (: any, <any>, Array<any>, as any)
if echo "$CONTENT" | grep -qE '(: any[^a-zA-Z]|<any>|Array<any>|\bas any\b)'; then
  block "NEVER use the 'any' type" \
        "Use 'unknown' and narrow, or use proper generics."
fi

# No @ts-ignore or @ts-expect-error (only in comment context, not string literals)
if echo "$CONTENT" | grep -qE '^\s*//\s*@ts-(ignore|expect-error)|/\*.*@ts-(ignore|expect-error)'; then
  block "NEVER use @ts-ignore or @ts-expect-error" \
        "Fix the type error properly."
fi

# No non-null assertions (!) — exclude != and !== and comments
if echo "$CONTENT" | grep -qE '[a-zA-Z0-9_\])]![^=]' | grep -vE '^\s*//'; then
  # Double-check: strip comments and look again
  stripped=$(echo "$CONTENT" | grep -vE '^\s*//')
  if echo "$stripped" | grep -qE '[a-zA-Z0-9_\])]![^=]'; then
    block "NEVER use non-null assertions (!)" \
          "Use proper null checks or optional chaining (?.)."
  fi
fi

# No process.env or import.meta.env direct access
if echo "$CONTENT" | grep -qE '(process\.env\.|import\.meta\.env\.)' | grep -vE '^\s*//'; then
  stripped=$(echo "$CONTENT" | grep -vE '^\s*//')
  if echo "$stripped" | grep -qE '(process\.env\.|import\.meta\.env\.)'; then
    block "NEVER access process.env or import.meta.env directly" \
          "Use a Zod-validated env schema."
  fi
fi

# ── State Management ─────────────────────────────────────────────────────────

# No createContext
if echo "$CONTENT" | grep -qE '\bcreateContext\b'; then
  block "NEVER use createContext" \
        "Use Jotai atoms instead."
fi

# ── Component Patterns ───────────────────────────────────────────────────────

# No class components
if echo "$CONTENT" | grep -qE 'extends (React\.)?(Component|PureComponent)'; then
  block "NEVER use class components" \
        "Use function components only."
fi

# ── Store naming conventions ─────────────────────────────────────────────────

# atoms.ts must export *Atom names
case "$FILE_PATH" in
  */store/atoms.ts)
    if echo "$CONTENT" | grep -qE '^export (const|let) [a-z][a-zA-Z]*[^A][^t][^o][^m]' 2>/dev/null; then
      warn "atoms.ts exports should be named *Atom (e.g. projectsAtom)" \
           "Rename exports to follow the *Atom convention."
    fi
    ;;
esac

# actions.ts must export do* names
case "$FILE_PATH" in
  */store/actions.ts)
    if echo "$CONTENT" | grep -qE '^export (const|let) [a-z]' 2>/dev/null; then
      if ! echo "$CONTENT" | grep -qE '^export (const|let) do[A-Z]'; then
        warn "actions.ts exports should be named do* (e.g. doSwitchThreadAtom)" \
             "Rename exports to follow the do* convention."
      fi
    fi
    ;;
esac

# ── Styling ──────────────────────────────────────────────────────────────────

# No inline styles
if echo "$CONTENT" | grep -qE 'style=\{\{'; then
  block "No inline styles (style={{}})" \
        "Use Tailwind classes instead."
fi

# No arbitrary Tailwind values
if echo "$CONTENT" | grep -qE 'className=.*\[.+\]'; then
  block "No arbitrary Tailwind values (e.g. w-[347px])" \
        "Use theme tokens from the design system."
fi

# No color-specific Tailwind classes (bg-red-500, text-blue-300, etc.)
if echo "$CONTENT" | grep -qE 'className=.*(bg|text|border|ring|outline|fill|stroke|shadow|decoration|caret|accent|from|to|via)-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|white|black)-[0-9]'; then
  block "No color-specific Tailwind classes (e.g. bg-blue-500, text-red-300)" \
        "Use design tokens instead (e.g. bg-primary, text-destructive, text-muted-foreground)."
fi

# No className string concatenation (must use cn() or clsx())
if echo "$CONTENT" | grep -qE 'className=\{`|className=\{"[^"]*"\s*\+|className=\{[a-zA-Z_]+\s*\+'; then
  block "No className string concatenation" \
        "Use cn() or clsx() for conditional class merging."
fi

# No JS animation libraries (framer-motion, react-spring, etc.)
if echo "$CONTENT" | grep -qE "from ['\"]framer-motion['\"]|from ['\"]react-spring['\"]|from ['\"]@react-spring|from ['\"]motion['\"]"; then
  block "No JS animation libraries" \
        "Use CSS/Tailwind transitions only (transition-*, animate-*)."
fi

# No empty <div> or <span> (divs/spans with only layout classes and no semantic content)
if echo "$CONTENT" | grep -qE '<(div|span)[^>]*></\1>'; then
  block "No empty <div> or <span> elements" \
        "Use semantic HTML (section, article, header, footer, main, aside, nav, dl/dt/dd, etc.)."
fi

# ── Code Quality ─────────────────────────────────────────────────────────────

# No export default
if echo "$CONTENT" | grep -qE '^export default '; then
  block "No 'export default'" \
        "Use named exports only."
fi

# No console.log (console.warn and console.error are OK)
if echo "$CONTENT" | grep -qE '\bconsole\.log\b'; then
  block "No console.log" \
        "Use structured logging. console.warn and console.error are allowed."
fi

# No nested ternaries
if echo "$CONTENT" | grep -qE '\?[^:]+\?[^:]+:'; then
  # Heuristic: flag if there are two ? before the first matching :
  # This is approximate — better than nothing
  warn "Possible nested ternary detected" \
       "Use early returns or if/else instead."
fi

# No hardcoded localhost or IP addresses
if echo "$CONTENT" | grep -qE '(localhost|127\.0\.0\.1|0\.0\.0\.0):[0-9]+' | grep -vE '^\s*//'; then
  stripped=$(echo "$CONTENT" | grep -vE '^\s*//')
  if echo "$stripped" | grep -qE '(localhost|127\.0\.0\.1|0\.0\.0\.0):[0-9]+'; then
    block "No hardcoded localhost or IP addresses" \
          "Use environment variables via the validated env schema."
  fi
fi

# ── File size ────────────────────────────────────────────────────────────────

LINE_COUNT=$(echo "$CONTENT" | wc -l | tr -d ' ')
if [[ "$LINE_COUNT" -gt 300 ]]; then
  block "Max 300 lines per file (this file has $LINE_COUNT lines)" \
        "Split into smaller modules."
fi

exit 0
