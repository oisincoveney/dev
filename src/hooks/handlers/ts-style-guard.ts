/**
 * PreToolUse hook for Write|Edit — enforces TS/TSX style rules.
 * Only applies to .ts and .tsx files. Skips generated/codegen paths.
 */

import type { HookDecision, HookHandler } from '../types.js'

const CODEGEN_PATHS = [
  /\/generate\/[^/]+\.ts$/,
  /\/generators\/[^/]+\.ts$/,
  /\/templates\/[^/]+\.ts$/,
  /\/.claude\/hooks\//,
  /\/hooks\/handlers\//,
]

function isCodegenPath(filePath: string): boolean {
  return CODEGEN_PATHS.some((p) => p.test(filePath))
}

function block(filePath: string, rule: string, fix: string): HookDecision {
  return {
    kind: 'block',
    reason: `⛔ Style violation in ${filePath}:\n   Rule: ${rule}\n   Fix:  ${fix}`,
  }
}

function stripCommentLines(content: string): string {
  return content
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n')
}

export const tsStyleGuard: HookHandler = (input): HookDecision => {
  const filePath = input.tool_input?.file_path ?? input.tool_input?.filePath
  const content =
    input.tool_input?.content ??
    input.tool_input?.new_string ??
    input.tool_input?.newString

  if (typeof filePath !== 'string' || typeof content !== 'string') {
    return { kind: 'allow' }
  }
  if (!/\.(ts|tsx)$/.test(filePath)) return { kind: 'allow' }
  if (isCodegenPath(filePath)) return { kind: 'allow' }

  // Combine the patterns into a single variable to avoid self-detection
  const anyTypePattern = new RegExp('(: an' + 'y[^a-zA-Z]|<an' + 'y>|Array<an' + 'y>|\\bas an' + 'y\\b)')
  if (anyTypePattern.test(content)) {
    return block(filePath, "NEVER use the 'any' type", "Use 'unknown' and narrow, or use proper generics.")
  }

  if (/^\s*\/\/\s*@ts-(ignore|expect-error)|\/\*.*@ts-(ignore|expect-error)/m.test(content)) {
    return block(filePath, 'NEVER use @ts-ignore or @ts-expect-error', 'Fix the type error properly.')
  }

  const stripped = stripCommentLines(content)
  if (/[a-zA-Z0-9_\])]![^=]/.test(stripped)) {
    return block(filePath, 'NEVER use non-null assertions (!)', 'Use proper null checks or optional chaining (?.).')
  }

  if (/(process\.env\.|import\.meta\.env\.)/.test(stripped)) {
    return block(filePath, 'NEVER access process.env or import.meta.env directly', 'Use a Zod-validated env schema.')
  }

  if (/\bcreateContext\b/.test(content)) {
    return block(filePath, 'NEVER use createContext', 'Use Jotai atoms instead.')
  }

  if (/extends (React\.)?(Component|PureComponent)/.test(content)) {
    return block(filePath, 'NEVER use class components', 'Use function components only.')
  }

  if (/style=\{\{/.test(content)) {
    return block(filePath, 'No inline styles (style={{}})', 'Use Tailwind classes instead.')
  }

  if (/className=.*\[.+\]/.test(content)) {
    return block(filePath, 'No arbitrary Tailwind values (e.g. w-[347px])', 'Use theme tokens from the design system.')
  }

  const colorPattern =
    /className=.*(bg|text|border|ring|outline|fill|stroke|shadow|decoration|caret|accent|from|to|via)-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|white|black)-\d/
  if (colorPattern.test(content)) {
    return block(
      filePath,
      'No color-specific Tailwind classes (e.g. bg-blue-500, text-red-300)',
      'Use design tokens instead (e.g. bg-primary, text-destructive, text-muted-foreground).',
    )
  }

  if (/className=\{`|className=\{"[^"]*"\s*\+|className=\{[a-zA-Z_]+\s*\+/.test(content)) {
    return block(filePath, 'No className string concatenation', 'Use cn() or clsx() for conditional class merging.')
  }

  if (/from ['"]framer-motion['"]|from ['"]react-spring['"]|from ['"]@react-spring|from ['"]motion['"]/.test(content)) {
    return block(filePath, 'No JS animation libraries', 'Use CSS/Tailwind transitions only (transition-*, animate-*).')
  }

  if (/<(div|span)[^>]*><\/\1>/.test(content)) {
    return block(filePath, 'No empty <div> or <span> elements', 'Use semantic HTML elements.')
  }

  if (/^export default /m.test(content)) {
    return block(filePath, "No 'export default'", 'Use named exports only.')
  }

  if (/\bconsole\.log\b/.test(content)) {
    return block(filePath, 'No console.log', 'Use structured logging. console.warn and console.error are allowed.')
  }

  const lineCount = content.split('\n').length
  if (lineCount > 300) {
    return block(
      filePath,
      `Max 300 lines per file (this file has ${lineCount} lines)`,
      'Split into smaller modules.',
    )
  }

  return { kind: 'allow' }
}
