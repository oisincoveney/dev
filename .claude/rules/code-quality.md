---
name: code-quality
description: Strict type systems, no hacks, meaningful names, early returns
---

# Code Quality & Strictness

- No `any` / no raw error suppression (@ts-ignore, unwrap, ignored errors)
- No magic numbers — extract to named constants
- Early returns over nested conditionals
- Meaningful names — no generic terms like `data`, `info`, `item`, `manager`, `handler`, `util`, `helper`, `tmp`
- No abbreviations unless universal (id, url, db)
- DRY at 2 occurrences — if you write it twice, extract it
