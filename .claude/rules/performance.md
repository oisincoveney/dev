---
name: performance
description: Fine-grained subscriptions, stable references, lazy loading
---

# Performance

- Avoid inline arrow functions in hot paths — extract to named functions
- Avoid inline object/array literals in props — extract to variables
- Stable references for callbacks
- Keys: stable unique identifiers, never array indices
- Lazy load routes and heavy components
