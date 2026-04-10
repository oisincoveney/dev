// src/rules.ts
function stripStrings(line) {
  return line.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/`(?:[^`\\]|\\.)*`/g, "``");
}
function stripComments(line) {
  const idx = line.indexOf("//");
  if (idx === -1)
    return line;
  const beforeSlash = line.slice(0, idx);
  const singleQuotes = (beforeSlash.match(/'/g) || []).length;
  const doubleQuotes = (beforeSlash.match(/"/g) || []).length;
  if (singleQuotes % 2 === 0 && doubleQuotes % 2 === 0) {
    return line.slice(0, idx);
  }
  return line;
}
function hasInlineComment(line) {
  const stripped = stripStrings(line);
  return stripped.includes("//");
}
function isClassNameContext(line) {
  return /(?:className|class)\s*=/.test(line) || /cn\(|clsx\(|cva\(/.test(line);
}
var TAILWIND_COLORS = [
  "red",
  "blue",
  "green",
  "yellow",
  "orange",
  "purple",
  "pink",
  "indigo",
  "violet",
  "emerald",
  "teal",
  "cyan",
  "amber",
  "lime",
  "fuchsia",
  "rose",
  "sky",
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
  "white",
  "black"
];
var COLOR_PREFIXES = [
  "bg",
  "text",
  "border",
  "ring",
  "fill",
  "stroke",
  "shadow",
  "outline",
  "decoration",
  "accent",
  "caret",
  "divide",
  "from",
  "to",
  "via",
  "placeholder"
];
var colorRegex = new RegExp(`(?:${COLOR_PREFIXES.join("|")})-(?:${TAILWIND_COLORS.join("|")})-`);
var ARBITRARY_PREFIXES = [
  "w",
  "h",
  "p",
  "px",
  "py",
  "pt",
  "pb",
  "pl",
  "pr",
  "m",
  "mx",
  "my",
  "mt",
  "mb",
  "ml",
  "mr",
  "gap",
  "space-x",
  "space-y",
  "text",
  "font",
  "leading",
  "tracking",
  "bg",
  "border",
  "rounded",
  "top",
  "bottom",
  "left",
  "right",
  "inset",
  "max-w",
  "max-h",
  "min-w",
  "min-h",
  "basis",
  "grow",
  "shrink",
  "columns",
  "rows",
  "cols",
  "size",
  "aspect",
  "translate-x",
  "translate-y",
  "rotate",
  "scale",
  "opacity",
  "blur",
  "brightness",
  "contrast",
  "grayscale",
  "duration",
  "delay",
  "ease"
];
var arbitraryRegex = new RegExp(`(?:${ARBITRARY_PREFIXES.join("|")})-\\[[^\\]]+\\]`);
var ANIMATION_LIBS = [
  "framer-motion",
  "react-spring",
  "@react-spring",
  "gsap",
  "animejs",
  "anime",
  "motion",
  "react-transition-group"
];
var animationImportRegex = new RegExp(`(?:import|require).*(?:${ANIMATION_LIBS.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`);
function checkContent(content, filePath) {
  const violations = [];
  const warnings = [];
  const lines = content.split(`
`);
  const isJsx = filePath.endsWith(".tsx") || filePath.endsWith(".jsx");
  for (let i = 0;i < lines.length; i++) {
    const line = lines[i];
    const ln = i + 1;
    const trimmed = line.trimStart();
    const isComment = trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
    const cleaned = stripComments(stripStrings(line));
    if (/@ts-ignore|@ts-expect-error/.test(line)) {
      violations.push({
        line: ln,
        rule: 4,
        message: "No `@ts-ignore` or `@ts-expect-error` — fix the type error properly."
      });
    }
    if (isComment)
      continue;
    if (/:\s*any\b|<any\s*>|<any\s*,|\bas\s+any\b|\bany\s*[,)\]>]/.test(cleaned)) {
      violations.push({
        line: ln,
        rule: 1,
        message: "No `any` type — use `unknown` and narrow, or use a proper generic."
      });
    }
    if (/\bas\s+[A-Z]/.test(cleaned) && !hasInlineComment(line)) {
      violations.push({
        line: ln,
        rule: 2,
        message: "Type assertion (`as X`) requires a justifying comment on the same line."
      });
    }
    if (/(?<=[)\w\]])!(?!\s*=)(?=[.;\s,)\]<])/.test(cleaned)) {
      violations.push({
        line: ln,
        rule: 3,
        message: "No non-null assertions (`!`) — use proper null checks or optional chaining."
      });
    }
    if (/process\.env\.\w|import\.meta\.env\.\w/.test(cleaned)) {
      if (!/env\.ts|env\.schema|env\.config|env\.validation/.test(filePath)) {
        violations.push({
          line: ln,
          rule: 7,
          message: "Access environment variables through a Zod-validated schema, not directly via process.env or import.meta.env."
        });
      }
    }
    if (/class\s+\w+\s+extends\s+(?:React\.)?(?:Component|PureComponent)/.test(cleaned)) {
      violations.push({
        line: ln,
        rule: 9,
        message: "No class components — use function components."
      });
    }
    if (isJsx) {
      const funcMatch = cleaned.match(/export\s+(?:const|function)\s+([A-Z]\w+)/);
      if (funcMatch) {
        const context = lines.slice(i, Math.min(i + 3, lines.length)).join(" ");
        if (!/Props|:\s*\{|<\w+>|React\.FC/.test(context) && /[=(]/.test(context)) {
          warnings.push({
            line: ln,
            rule: 10,
            message: `Component \`${funcMatch[1]}\` should have an explicit Props interface.`
          });
        }
      }
    }
    if (/createContext\s*[<(]/.test(cleaned)) {
      violations.push({
        line: ln,
        rule: 14,
        message: "No `createContext` — use Jotai atoms for state management."
      });
    }
    if (/\buseState\s*[<(]/.test(cleaned)) {
      warnings.push({
        line: ln,
        rule: 15,
        message: "Consider using Jotai atoms instead of `useState`. Only use `useState` for simple local UI state (open/closed, hover, etc.)."
      });
    }
    if (/\buseRef\s*[<(]/.test(cleaned)) {
      const refContext = lines.slice(i, Math.min(i + 2, lines.length)).join(" ");
      if (!/HTML\w+Element|SVGElement|Element\b|null\s*\)/.test(refContext)) {
        warnings.push({
          line: ln,
          rule: 16,
          message: "`useRef` should only be used for DOM refs and library integration, not for storing data across renders. Use Jotai atoms instead."
        });
      }
    }
    if (isJsx && /style\s*=\s*\{\{/.test(cleaned)) {
      violations.push({
        line: ln,
        rule: 32,
        message: "No inline styles — use Tailwind classes."
      });
    }
    if (isClassNameContext(line) && arbitraryRegex.test(line)) {
      violations.push({
        line: ln,
        rule: 31,
        message: "No arbitrary Tailwind values (bracket syntax like `w-[347px]`) — use theme tokens or standard Tailwind classes."
      });
    }
    if (/className\s*=\s*\{[^}]*\+/.test(cleaned)) {
      violations.push({
        line: ln,
        rule: 33,
        message: "No string concatenation for className — use `cn()` or `clsx()`."
      });
    }
    if (isClassNameContext(line) && colorRegex.test(line)) {
      violations.push({
        line: ln,
        rule: 34,
        message: "No color-specific Tailwind classes (e.g., `bg-blue-500`) — use theme/design tokens."
      });
    }
    if (isClassNameContext(line)) {
      const classMatch = line.match(/["'`]([^"'`]{120,})["'`]/);
      if (classMatch) {
        warnings.push({
          line: ln,
          rule: 35,
          message: "Long className string — extract to a variable or component for readability."
        });
      }
    }
    if (isJsx && /<img\b/.test(line) && /\.svg/.test(line)) {
      violations.push({
        line: ln,
        rule: 38,
        message: "No `<img>` for SVG icons — import SVGs as React components."
      });
    }
    if (isJsx && /<img\b/.test(line) && !/\.svg/.test(line)) {
      if (!/loading\s*=\s*["']lazy["']/.test(line)) {
        warnings.push({
          line: ln,
          rule: 39,
          message: 'Images should use `loading="lazy"` and have explicit width/height.'
        });
      }
    }
    if (animationImportRegex.test(line)) {
      violations.push({
        line: ln,
        rule: 40,
        message: "No JS animation libraries — use CSS/Tailwind transitions only. Get explicit approval before using animation libraries."
      });
    }
    if (/z-\[/.test(line) || /zIndex\s*:/.test(cleaned)) {
      violations.push({
        line: ln,
        rule: 41,
        message: "No arbitrary z-index — use Tailwind `z-*` scale classes only."
      });
    }
    if (isJsx && /<div\s*\/?\s*>(\s*<\/div>)?/.test(cleaned) && /<div\s*\/\s*>|<div\s*>\s*<\/div>/.test(cleaned)) {
      violations.push({
        line: ln,
        rule: 42,
        message: "No empty `<div>` elements — use semantic HTML or remove."
      });
    }
    if (isJsx && /<span\s*\/\s*>|<span\s*>\s*<\/span>/.test(cleaned)) {
      violations.push({
        line: ln,
        rule: 43,
        message: "No empty `<span>` elements — use semantic HTML or remove."
      });
    }
    if (/\?[^?:]*\?/.test(cleaned)) {
      violations.push({
        line: ln,
        rule: 47,
        message: "No nested ternaries — use early returns or if/else blocks."
      });
    }
    if (/^export\s+default\b/.test(trimmed)) {
      violations.push({
        line: ln,
        rule: 49,
        message: "No `export default` — use named exports only."
      });
    }
    if (/console\.log\s*\(/.test(cleaned)) {
      violations.push({
        line: ln,
        rule: 50,
        message: "No `console.log` — use structured logging. `console.warn` and `console.error` are OK."
      });
    }
    if (/https?:\/\/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(line)) {
      violations.push({
        line: ln,
        rule: 51,
        message: "No hardcoded URLs (localhost, 127.0.0.1) — use environment variables."
      });
    }
    if (isJsx && /(?:onClick|onChange|onSubmit|onBlur|onFocus|onKeyDown|onKeyUp|onMouseEnter|onMouseLeave)\s*=\s*\{\s*\(/.test(cleaned)) {
      warnings.push({
        line: ln,
        rule: 77,
        message: "Avoid inline arrow functions in JSX event handlers — extract to a `handle*` function for stable references."
      });
    }
    if (isJsx) {
      const propLiteralMatch = cleaned.match(/(\w+)\s*=\s*\{\s*[{[]/);
      if (propLiteralMatch) {
        const propName = propLiteralMatch[1];
        if (!["className", "style", "key", "class", "dangerouslySetInnerHTML"].includes(propName)) {
          warnings.push({
            line: ln,
            rule: 79,
            message: `Avoid inline object/array literals in JSX prop \`${propName}\` — extract to a variable or useMemo for stable references.`
          });
        }
      }
    }
  }
  if (lines.length > 300) {
    violations.push({
      line: lines.length,
      rule: 27,
      message: `File is ${lines.length} lines (max 300) — split into smaller modules.`
    });
  }
  return { violations, warnings };
}
function checkFilePath(filePath) {
  const violations = [];
  const storeMatch = filePath.match(/features\/[^/]+\/store\/([^/]+)$/);
  if (storeMatch) {
    const allowedFiles = [
      "atoms.ts",
      "families.ts",
      "actions.ts",
      "listeners.ts",
      "handlers.ts",
      "types.ts",
      "index.ts"
    ];
    if (!allowedFiles.includes(storeMatch[1])) {
      violations.push({
        line: 0,
        rule: 21,
        message: `Store file \`${storeMatch[1]}\` does not match allowed pattern. Allowed: ${allowedFiles.join(", ")}.`
      });
    }
  }
  if (/\/ws\/|\/infrastructure\//.test(filePath)) {
    violations.push({
      line: 0,
      rule: 26,
      message: "Infrastructure layer (ws/, infrastructure/) is read-only for AI. Do not modify these files without explicit approval."
    });
  }
  const parts = filePath.split("/");
  for (const part of parts) {
    if (part.includes(".") || part.startsWith(".") || part === "node_modules" || part === "__tests__") {
      continue;
    }
    if (/[A-Z]/.test(part)) {
      violations.push({
        line: 0,
        rule: 28,
        message: `Folder name \`${part}\` must be kebab-case (e.g., \`${part.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()}\`).`
      });
      break;
    }
  }
  if (/\/components\/ui\/[^/]+$/.test(filePath)) {
    violations.push({
      line: 0,
      rule: 37,
      message: "Do not create new base UI components in `components/ui/` without explicit approval. Compose from existing ShadCN components instead."
    });
  }
  return violations;
}
function checkStoreNaming(content, filePath) {
  const violations = [];
  const storeMatch = filePath.match(/features\/[^/]+\/store\/([^/]+)\.ts$/);
  if (!storeMatch)
    return violations;
  const storeFile = storeMatch[1];
  const lines = content.split(`
`);
  for (let i = 0;i < lines.length; i++) {
    const line = lines[i];
    const ln = i + 1;
    const exportMatch = line.match(/export\s+(?:const|function)\s+(\w+)/);
    if (!exportMatch)
      continue;
    const name = exportMatch[1];
    switch (storeFile) {
      case "atoms":
        if (!name.endsWith("Atom") && !name.startsWith("use")) {
          violations.push({
            line: ln,
            rule: 22,
            message: `Atom export \`${name}\` should end with \`Atom\` (e.g., \`${name}Atom\`).`
          });
        }
        break;
      case "families":
        if (!name.endsWith("AtomFamily")) {
          violations.push({
            line: ln,
            rule: 22,
            message: `Atom family export \`${name}\` should end with \`AtomFamily\` (e.g., \`${name}AtomFamily\`).`
          });
        }
        break;
      case "actions":
        if (!name.startsWith("do") || !name.endsWith("Atom")) {
          violations.push({
            line: ln,
            rule: 22,
            message: `Write atom export \`${name}\` should follow \`doXxxAtom\` pattern (e.g., \`do${name.charAt(0).toUpperCase() + name.slice(1)}Atom\`).`
          });
        }
        break;
      case "listeners":
        if (!name.startsWith("use") || !name.endsWith("Listeners")) {
          violations.push({
            line: ln,
            rule: 22,
            message: `Listener export \`${name}\` should follow \`useXxxListeners\` pattern.`
          });
        }
        break;
      case "handlers":
        if (!name.startsWith("create") || !name.endsWith("Handlers")) {
          violations.push({
            line: ln,
            rule: 22,
            message: `Handler export \`${name}\` should follow \`createXxxHandlers\` pattern.`
          });
        }
        break;
    }
  }
  return violations;
}
function checkTestColocation(filePath) {
  const warnings = [];
  if (/\.test\.(ts|tsx)$/.test(filePath)) {
    return warnings;
  }
  return warnings;
}
function runAllChecks(content, filePath) {
  const contentResult = checkContent(content, filePath);
  const pathViolations = checkFilePath(filePath);
  const namingViolations = checkStoreNaming(content, filePath);
  return {
    violations: [...contentResult.violations, ...pathViolations, ...namingViolations],
    warnings: contentResult.warnings
  };
}
export {
  runAllChecks,
  checkTestColocation,
  checkStoreNaming,
  checkFilePath,
  checkContent
};
