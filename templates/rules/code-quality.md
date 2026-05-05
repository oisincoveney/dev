---
name: code-quality
description: Strict type systems, no hacks, meaningful names, early returns
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
  - "**/*.mjs"
  - "**/*.cjs"
  - "**/*.rs"
  - "**/*.go"
  - "**/*.swift"
  - "**/*.py"
  - "**/*.rb"
---

# Code Quality & Strictness

- No `any`, no raw error suppression (@ts-ignore, unwrap, ignored errors).
- No magic numbers — extract named constants.
- Early returns over nested conditionals.
- Meaningful names — no generic `data`/`info`/`item`/`manager`/`handler`/`util`/`helper`/`tmp`.
- No abbreviations unless universal (id, url, db).
- DRY at 2 occurrences — write twice → extract.
