/**
 * Frontend TypeScript Style Rule Engine
 *
 * Single source of truth for all mechanically-enforceable coding rules.
 * Used by: Claude Code hooks, Opencode plugins, lefthook pre-commit.
 *
 * Exports checkContent() and checkFilePath() for programmatic use.
 * Also works as a CLI: reads Claude PreToolUse JSON from stdin.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Violation {
  line: number
  rule: number
  message: string
}

export interface Warning {
  line: number
  rule: number
  message: string
}

export interface CheckResult {
  violations: Violation[]
  warnings: Warning[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Strip string literals and template literals to avoid false positives */
function stripStrings(line: string): string {
  return line
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
}

/** Strip single-line comments */
function stripComments(line: string): string {
  // Don't strip if the whole line is a comment (we skip those separately)
  const idx = line.indexOf('//')
  if (idx === -1) return line
  // Make sure it's not inside a string (check if before any quote)
  const beforeSlash = line.slice(0, idx)
  const singleQuotes = (beforeSlash.match(/'/g) || []).length
  const doubleQuotes = (beforeSlash.match(/"/g) || []).length
  if (singleQuotes % 2 === 0 && doubleQuotes % 2 === 0) {
    return line.slice(0, idx)
  }
  return line
}

/** Check if line has an inline comment (for rules that allow with justification) */
function hasInlineComment(line: string): boolean {
  const stripped = stripStrings(line)
  return stripped.includes('//')
}

/** Check if a line is in a className/class context */
function isClassNameContext(line: string): boolean {
  return /(?:className|class)\s*=/.test(line) || /cn\(|clsx\(|cva\(/.test(line)
}

// All Tailwind color names
const TAILWIND_COLORS = [
  'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink',
  'indigo', 'violet', 'emerald', 'teal', 'cyan', 'amber', 'lime',
  'fuchsia', 'rose', 'sky', 'slate', 'gray', 'zinc', 'neutral', 'stone',
  'white', 'black',
]

const COLOR_PREFIXES = [
  'bg', 'text', 'border', 'ring', 'fill', 'stroke', 'shadow',
  'outline', 'decoration', 'accent', 'caret', 'divide', 'from', 'to', 'via',
  'placeholder',
]

// Build color regex: (bg|text|...)-( red|blue|...)-
const colorRegex = new RegExp(
  `(?:${COLOR_PREFIXES.join('|')})-(?:${TAILWIND_COLORS.join('|')})-`,
)

// Arbitrary Tailwind value prefixes that should not use bracket syntax
const ARBITRARY_PREFIXES = [
  'w', 'h', 'p', 'px', 'py', 'pt', 'pb', 'pl', 'pr',
  'm', 'mx', 'my', 'mt', 'mb', 'ml', 'mr',
  'gap', 'space-x', 'space-y',
  'text', 'font', 'leading', 'tracking',
  'bg', 'border', 'rounded',
  'top', 'bottom', 'left', 'right', 'inset',
  'max-w', 'max-h', 'min-w', 'min-h',
  'basis', 'grow', 'shrink',
  'columns', 'rows', 'cols',
  'size', 'aspect',
  'translate-x', 'translate-y', 'rotate', 'scale',
  'opacity', 'blur', 'brightness', 'contrast', 'grayscale',
  'duration', 'delay', 'ease',
]

const arbitraryRegex = new RegExp(
  `(?:${ARBITRARY_PREFIXES.join('|')})-\\[[^\\]]+\\]`,
)

// Animation library imports
const ANIMATION_LIBS = [
  'framer-motion', 'react-spring', '@react-spring',
  'gsap', 'animejs', 'anime', 'motion',
  'react-transition-group',
]

const animationImportRegex = new RegExp(
  `(?:import|require).*(?:${ANIMATION_LIBS.map(l => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
)

// ─── Content Checks ──────────────────────────────────────────────────────────

export function checkContent(content: string, filePath: string): CheckResult {
  const violations: Violation[] = []
  const warnings: Warning[] = []
  const lines = content.split('\n')
  const isJsx = filePath.endsWith('.tsx') || filePath.endsWith('.jsx')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const ln = i + 1
    const trimmed = line.trimStart()

    // Skip comment lines for MOST rules — but rule 4 needs to check comments
    const isComment = trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')

    // `cleaned` strips strings+comments — use for rules where string content causes false positives
    // `line` (original) — use for rules checking content INSIDE strings (className values, imports, URLs)
    const cleaned = stripComments(stripStrings(line))

    // ── Rule 4: No @ts-ignore or @ts-expect-error ──
    // Must check BEFORE the comment skip since these ARE in comments
    if (/@ts-ignore|@ts-expect-error/.test(line)) {
      violations.push({
        line: ln,
        rule: 4,
        message: 'No `@ts-ignore` or `@ts-expect-error` — fix the type error properly.',
      })
    }

    if (isComment) continue

    // ── Rule 1: No `any` type ──
    if (/:\s*any\b|<any\s*>|<any\s*,|\bas\s+any\b|\bany\s*[,)\]>]/.test(cleaned)) {
      violations.push({
        line: ln,
        rule: 1,
        message: 'No `any` type — use `unknown` and narrow, or use a proper generic.',
      })
    }

    // ── Rule 2: No type assertions without justifying comment ──
    if (/\bas\s+[A-Z]/.test(cleaned) && !hasInlineComment(line)) {
      violations.push({
        line: ln,
        rule: 2,
        message: 'Type assertion (`as X`) requires a justifying comment on the same line.',
      })
    }

    // ── Rule 3: No non-null assertions ──
    // Match word! or )! followed by . ; , ) ] or end-of-statement
    // Exclude !== and != and !identifier (boolean negation)
    if (/(?<=[)\w\]])!(?!\s*=)(?=[.;\s,)\]<])/.test(cleaned)) {
      violations.push({
        line: ln,
        rule: 3,
        message: 'No non-null assertions (`!`) — use proper null checks or optional chaining.',
      })
    }

    // ── Rule 7: Zod-validated env — flag raw env access ──
    if (/process\.env\.\w|import\.meta\.env\.\w/.test(cleaned)) {
      // Allow in files that look like env schemas
      if (!/env\.ts|env\.schema|env\.config|env\.validation/.test(filePath)) {
        violations.push({
          line: ln,
          rule: 7,
          message: 'Access environment variables through a Zod-validated schema, not directly via process.env or import.meta.env.',
        })
      }
    }

    // ── Rule 9: No class components ──
    if (/class\s+\w+\s+extends\s+(?:React\.)?(?:Component|PureComponent)/.test(cleaned)) {
      violations.push({
        line: ln,
        rule: 9,
        message: 'No class components — use function components.',
      })
    }

    // ── Rule 10: Component without Props interface ──
    // Detect `export function ComponentName(` or `export const ComponentName =` without Props
    if (isJsx) {
      const funcMatch = cleaned.match(/export\s+(?:const|function)\s+([A-Z]\w+)/)
      if (funcMatch) {
        // Check if this line or the next few lines reference Props or a type parameter
        const context = lines.slice(i, Math.min(i + 3, lines.length)).join(' ')
        if (!/Props|:\s*\{|<\w+>|React\.FC/.test(context) && /[=(]/.test(context)) {
          warnings.push({
            line: ln,
            rule: 10,
            message: `Component \`${funcMatch[1]}\` should have an explicit Props interface.`,
          })
        }
      }
    }

    // ── Rule 14: No createContext ──
    if (/createContext\s*[<(]/.test(cleaned)) {
      violations.push({
        line: ln,
        rule: 14,
        message: 'No `createContext` — use Jotai atoms for state management.',
      })
    }

    // ── Rule 15: useState warning ──
    if (/\buseState\s*[<(]/.test(cleaned)) {
      warnings.push({
        line: ln,
        rule: 15,
        message: 'Consider using Jotai atoms instead of `useState`. Only use `useState` for simple local UI state (open/closed, hover, etc.).',
      })
    }

    // ── Rule 16: useRef warning ──
    if (/\buseRef\s*[<(]/.test(cleaned)) {
      // Check if typed as HTML/SVG element
      const refContext = lines.slice(i, Math.min(i + 2, lines.length)).join(' ')
      if (!/HTML\w+Element|SVGElement|Element\b|null\s*\)/.test(refContext)) {
        warnings.push({
          line: ln,
          rule: 16,
          message: '`useRef` should only be used for DOM refs and library integration, not for storing data across renders. Use Jotai atoms instead.',
        })
      }
    }

    // ── Rule 32: No inline styles ──
    if (isJsx && /style\s*=\s*\{\{/.test(cleaned)) {
      violations.push({
        line: ln,
        rule: 32,
        message: 'No inline styles — use Tailwind classes.',
      })
    }

    // ── Rule 31: No arbitrary Tailwind values ──
    // Check original line — the values ARE inside strings
    if (isClassNameContext(line) && arbitraryRegex.test(line)) {
      violations.push({
        line: ln,
        rule: 31,
        message: 'No arbitrary Tailwind values (bracket syntax like `w-[347px]`) — use theme tokens or standard Tailwind classes.',
      })
    }

    // ── Rule 33: No className string concatenation ──
    if (/className\s*=\s*\{[^}]*\+/.test(cleaned)) {
      violations.push({
        line: ln,
        rule: 33,
        message: 'No string concatenation for className — use `cn()` or `clsx()`.',
      })
    }

    // ── Rule 34: No color-specific Tailwind classes ──
    // Check original line — color names are inside className strings
    if (isClassNameContext(line) && colorRegex.test(line)) {
      violations.push({
        line: ln,
        rule: 34,
        message: 'No color-specific Tailwind classes (e.g., `bg-blue-500`) — use theme/design tokens.',
      })
    }

    // ── Rule 35: className soup warning ──
    if (isClassNameContext(line)) {
      const classMatch = line.match(/["'`]([^"'`]{120,})["'`]/)
      if (classMatch) {
        warnings.push({
          line: ln,
          rule: 35,
          message: 'Long className string — extract to a variable or component for readability.',
        })
      }
    }

    // ── Rule 38: No <img> for SVG icons ──
    // Check original line — .svg is inside a string attribute
    if (isJsx && /<img\b/.test(line) && /\.svg/.test(line)) {
      violations.push({
        line: ln,
        rule: 38,
        message: 'No `<img>` for SVG icons — import SVGs as React components.',
      })
    }

    // ── Rule 39: Images must lazy load with dimensions ──
    if (isJsx && /<img\b/.test(line) && !/\.svg/.test(line)) {
      if (!/loading\s*=\s*["']lazy["']/.test(line)) {
        warnings.push({
          line: ln,
          rule: 39,
          message: 'Images should use `loading="lazy"` and have explicit width/height.',
        })
      }
    }

    // ── Rule 40: No JS animation library imports ──
    // Check original line — library names are inside import strings
    if (animationImportRegex.test(line)) {
      violations.push({
        line: ln,
        rule: 40,
        message: 'No JS animation libraries — use CSS/Tailwind transitions only. Get explicit approval before using animation libraries.',
      })
    }

    // ── Rule 41: No arbitrary z-index ──
    // z-[ is inside className strings, zIndex is in code — check both on line
    if (/z-\[/.test(line) || /zIndex\s*:/.test(cleaned)) {
      violations.push({
        line: ln,
        rule: 41,
        message: 'No arbitrary z-index — use Tailwind `z-*` scale classes only.',
      })
    }

    // ── Rule 42: No empty divs ──
    if (isJsx && /<div\s*\/?\s*>(\s*<\/div>)?/.test(cleaned) && /<div\s*\/\s*>|<div\s*>\s*<\/div>/.test(cleaned)) {
      violations.push({
        line: ln,
        rule: 42,
        message: 'No empty `<div>` elements — use semantic HTML or remove.',
      })
    }

    // ── Rule 43: Empty spans ──
    if (isJsx && /<span\s*\/\s*>|<span\s*>\s*<\/span>/.test(cleaned)) {
      violations.push({
        line: ln,
        rule: 43,
        message: 'No empty `<span>` elements — use semantic HTML or remove.',
      })
    }

    // ── Rule 47: No nested ternaries ──
    if (/\?[^?:]*\?/.test(cleaned)) {
      violations.push({
        line: ln,
        rule: 47,
        message: 'No nested ternaries — use early returns or if/else blocks.',
      })
    }

    // ── Rule 49: No export default ──
    if (/^export\s+default\b/.test(trimmed)) {
      violations.push({
        line: ln,
        rule: 49,
        message: 'No `export default` — use named exports only.',
      })
    }

    // ── Rule 50: No console.log ──
    if (/console\.log\s*\(/.test(cleaned)) {
      violations.push({
        line: ln,
        rule: 50,
        message: 'No `console.log` — use structured logging. `console.warn` and `console.error` are OK.',
      })
    }

    // ── Rule 51: No hardcoded env values ──
    // URLs are inside strings — check original line
    if (/https?:\/\/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(line)) {
      violations.push({
        line: ln,
        rule: 51,
        message: 'No hardcoded URLs (localhost, 127.0.0.1) — use environment variables.',
      })
    }

    // ── Rule 77: Inline functions in JSX (warning) ──
    if (isJsx && /(?:onClick|onChange|onSubmit|onBlur|onFocus|onKeyDown|onKeyUp|onMouseEnter|onMouseLeave)\s*=\s*\{\s*\(/.test(cleaned)) {
      warnings.push({
        line: ln,
        rule: 77,
        message: 'Avoid inline arrow functions in JSX event handlers — extract to a `handle*` function for stable references.',
      })
    }

    // ── Rule 79: Inline object/array literals in JSX props ──
    if (isJsx) {
      // Match prop={{ or prop={[ but exclude className, style (handled separately), key
      const propLiteralMatch = cleaned.match(/(\w+)\s*=\s*\{\s*[{[]/)
      if (propLiteralMatch) {
        const propName = propLiteralMatch[1]
        if (!['className', 'style', 'key', 'class', 'dangerouslySetInnerHTML'].includes(propName)) {
          warnings.push({
            line: ln,
            rule: 79,
            message: `Avoid inline object/array literals in JSX prop \`${propName}\` — extract to a variable or useMemo for stable references.`,
          })
        }
      }
    }
  }

  // ── Rule 27: Max 300 lines per file ──
  if (lines.length > 300) {
    violations.push({
      line: lines.length,
      rule: 27,
      message: `File is ${lines.length} lines (max 300) — split into smaller modules.`,
    })
  }

  return { violations, warnings }
}

// ─── Path Checks ─────────────────────────────────────────────────────────────

export function checkFilePath(filePath: string): Violation[] {
  const violations: Violation[] = []

  // ── Rule 21: Store directory structure ──
  const storeMatch = filePath.match(/features\/[^/]+\/store\/([^/]+)$/)
  if (storeMatch) {
    const allowedFiles = [
      'atoms.ts', 'families.ts', 'actions.ts', 'listeners.ts',
      'handlers.ts', 'types.ts', 'index.ts',
    ]
    if (!allowedFiles.includes(storeMatch[1])) {
      violations.push({
        line: 0,
        rule: 21,
        message: `Store file \`${storeMatch[1]}\` does not match allowed pattern. Allowed: ${allowedFiles.join(', ')}.`,
      })
    }
  }

  // ── Rule 26: Infrastructure is read-only ──
  if (/\/ws\/|\/infrastructure\//.test(filePath)) {
    violations.push({
      line: 0,
      rule: 26,
      message: 'Infrastructure layer (ws/, infrastructure/) is read-only for AI. Do not modify these files without explicit approval.',
    })
  }

  // ── Rule 28: kebab-case folders ──
  const parts = filePath.split('/')
  for (const part of parts) {
    // Skip files (has extension), node_modules, hidden dirs, and common exceptions
    if (part.includes('.') || part.startsWith('.') || part === 'node_modules' || part === '__tests__') {
      continue
    }
    // Check for camelCase or PascalCase (has uppercase letter)
    if (/[A-Z]/.test(part)) {
      violations.push({
        line: 0,
        rule: 28,
        message: `Folder name \`${part}\` must be kebab-case (e.g., \`${part.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}\`).`,
      })
      break // Only report once per path
    }
  }

  // ── Rule 37: No new files in components/ui/ ──
  if (/\/components\/ui\/[^/]+$/.test(filePath)) {
    violations.push({
      line: 0,
      rule: 37,
      message: 'Do not create new base UI components in `components/ui/` without explicit approval. Compose from existing ShadCN components instead.',
    })
  }

  return violations
}

// ─── Store Naming Checks (Rule 22) ──────────────────────────────────────────

export function checkStoreNaming(content: string, filePath: string): Violation[] {
  const violations: Violation[] = []

  const storeMatch = filePath.match(/features\/[^/]+\/store\/([^/]+)\.ts$/)
  if (!storeMatch) return violations

  const storeFile = storeMatch[1]
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const ln = i + 1

    // Check exported names
    const exportMatch = line.match(/export\s+(?:const|function)\s+(\w+)/)
    if (!exportMatch) continue

    const name = exportMatch[1]

    switch (storeFile) {
      case 'atoms':
        if (!name.endsWith('Atom') && !name.startsWith('use')) {
          violations.push({
            line: ln,
            rule: 22,
            message: `Atom export \`${name}\` should end with \`Atom\` (e.g., \`${name}Atom\`).`,
          })
        }
        break
      case 'families':
        if (!name.endsWith('AtomFamily')) {
          violations.push({
            line: ln,
            rule: 22,
            message: `Atom family export \`${name}\` should end with \`AtomFamily\` (e.g., \`${name}AtomFamily\`).`,
          })
        }
        break
      case 'actions':
        if (!name.startsWith('do') || !name.endsWith('Atom')) {
          violations.push({
            line: ln,
            rule: 22,
            message: `Write atom export \`${name}\` should follow \`doXxxAtom\` pattern (e.g., \`do${name.charAt(0).toUpperCase() + name.slice(1)}Atom\`).`,
          })
        }
        break
      case 'listeners':
        if (!name.startsWith('use') || !name.endsWith('Listeners')) {
          violations.push({
            line: ln,
            rule: 22,
            message: `Listener export \`${name}\` should follow \`useXxxListeners\` pattern.`,
          })
        }
        break
      case 'handlers':
        if (!name.startsWith('create') || !name.endsWith('Handlers')) {
          violations.push({
            line: ln,
            rule: 22,
            message: `Handler export \`${name}\` should follow \`createXxxHandlers\` pattern.`,
          })
        }
        break
    }
  }

  return violations
}

// ─── Test Co-location Check (Rule 56) ───────────────────────────────────────

export function checkTestColocation(filePath: string): Warning[] {
  const warnings: Warning[] = []

  // If writing a test file, check it's next to the source
  if (/\.test\.(ts|tsx)$/.test(filePath)) {
    // Test file should be in the same directory as its source
    // This is informational — we can't always verify from the hook
    return warnings
  }

  return warnings
}

// ─── Main: Run all checks ────────────────────────────────────────────────────

export function runAllChecks(content: string, filePath: string): CheckResult {
  const contentResult = checkContent(content, filePath)
  const pathViolations = checkFilePath(filePath)
  const namingViolations = checkStoreNaming(content, filePath)

  return {
    violations: [...contentResult.violations, ...pathViolations, ...namingViolations],
    warnings: contentResult.warnings,
  }
}

