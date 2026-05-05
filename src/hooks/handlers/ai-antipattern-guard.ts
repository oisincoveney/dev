/**
 * PreToolUse/PostToolUse hook for Write|Edit — blocks known AI anti-patterns.
 */

import type { HookDecision, HookHandler } from '../types.js'

function isTestFile(filePath: string): boolean {
  return (
    /\.(test|spec)\.[a-z]+$/.test(filePath) ||
    /_test\.go$/.test(filePath) ||
    /[/\\](tests|__tests__)[/\\]/.test(filePath)
  )
}

function block(filePath: string, description: string, fix: string): HookDecision {
  return {
    kind: 'block',
    reason: `⛔ AI anti-pattern detected in ${filePath}:\n   ${description}\n${fix}`,
  }
}

export const aiAntipatternGuard: HookHandler = (input): HookDecision => {
  const filePath = input.tool_input?.file_path ?? input.tool_input?.filePath
  const content =
    input.tool_input?.content ??
    input.tool_input?.new_string ??
    input.tool_input?.newString

  if (typeof filePath !== 'string' || typeof content !== 'string') {
    return { kind: 'allow' }
  }

  const isTest = isTestFile(filePath)

  // 1. Bare except (Python)
  if (/^\s*except\s*:\s*(pass|None)?$/m.test(content)) {
    return block(filePath, 'Bare except clause (exception suppression)', '   Catch specific exception types and handle or re-raise them.')
  }

  // 2. Empty single-underscore catch
  if (/catch\s*\(\s*_\s*\)\s*\{\s*\}/.test(content)) {
    return block(filePath, 'Empty single-underscore catch block (exception suppression)', '   Handle the error or let it propagate.')
  }

  if (!isTest) {
    // 3. Stub "Not implemented" in production code
    if (/throw new Error\("Not implemented"\)|throw new Error\("TODO/.test(content)) {
      return block(filePath, "Stub 'Not implemented' in production code", "   Either implement it or file a bd issue: bd create '<description>'")
    }

    // 4. Rust todo/unimplemented macros
    if (/todo!\(\)|unimplemented!\(\)/.test(content)) {
      return block(filePath, 'Rust todo! or unimplemented! macro in production code', "   Either implement it or file a bd issue: bd create '<description>'")
    }

    // 5. Go stub panic
    if (/panic\("TODO"\)|panic\("not implemented"\)|errors\.New\("not implemented"\)/.test(content)) {
      return block(filePath, 'Go stub panic or sentinel error in production code', "   Either implement it or file a bd issue: bd create '<description>'")
    }

    // 6. Swallowed errors (catch returns null/empty)
    if (/catch\s*\([^)]*\)\s*\{\s*return\s+(null|\[\]|\{\})\s*;?\s*\}/.test(content)) {
      return block(filePath, 'catch block returns null or empty container (swallowed error)', '   Either propagate the error, log + rethrow, or document why empty is correct.')
    }

    // 7. TODO: implement comment
    if (/\/\/\s*(TODO|FIXME)\s*:?\s*implement\b/i.test(content)) {
      return block(filePath, '// TODO: implement comment in production code', "   Either implement it or file a bd issue: bd create '<description>'")
    }

    // 8. Placeholder strings (TS/JS only)
    if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(filePath)) {
      if (/"(replaceme|REPLACEME)"/.test(content)) {
        return block(filePath, "Placeholder string 'replaceme' in production code", '   Replace with the real value or extract to config.')
      }
    }
  }

  return { kind: 'allow' }
}
