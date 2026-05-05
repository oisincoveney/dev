---
name: performance
description: Fine-grained subscriptions, stable references, lazy loading
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

# Performance

- No inline arrow fns in hot paths — extract named fns.
- No inline object/array literals in props — extract variables.
- Stable refs for callbacks.
- Keys: stable unique IDs, never array indices.
- Lazy load routes + heavy components.
