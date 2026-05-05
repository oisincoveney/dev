---
name: architecture
description: Ousterhout deep modules, clean architecture layers, file size limits
---

# Architecture

**Deep modules over shallow ones** (Ousterhout):
- A module's interface should be much simpler than its implementation
- Information hiding is the goal — hide complexity behind simple APIs
- Red flags: pass-through methods, shallow modules that leak implementation details

**Layer discipline** (Clean Architecture):
- Domain/core layer cannot import from infrastructure/framework layer
- Dependencies point inward toward the core
- Enforced by dependency-cruiser (TS) or depguard (Go) or crate boundaries (Rust)

**File size limits**: max 300 lines per file, max 50 lines per function. Split if exceeded.

**Folder naming**: kebab-case for all folder names.
