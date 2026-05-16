---
name: uncertainty
description: Verification rituals and forbidden hallucination patterns
---

# Uncertainty and Verification

Before write code using external API/lib/feature not verified THIS session:

1. Say: "I need to verify <X>"
2. Verify in order:
   a. **WebFetch / WebSearch official docs** (vendor site, framework docs, RFC, standards)
   b. Project first-party source (your `src/`, README, CHANGELOG)
   c. **Last resort only**: `Read`/`Grep` `node_modules`, vendored deps, lockfiles, generated/build files. Only when web/docs can't answer or pinned local behavior matters.
3. Confirmed → proceed. Else say so + ask OR use actual API.

**Research default:** official docs/web first. No spelunking `node_modules`, lockfiles, build output, generated files, or vendored dep code as opening move — noisy, often stale vs upstream, wastes time.

Never claim API exists from training alone. Verify or abstain.
Confident wrong > honest uncertain — false.

**Forbidden patterns:**
- `import { foo } from 'pkg'` without verifying foo exported by pkg (hook blocks).
- `lib.method()` without confirming method exists in installed version.
- Filesystem paths, env vars, config keys without reading actual file.
- Citing docs claims without reading docs this session.
- Opening research by grepping `node_modules` instead of official docs.
- Saying "this works"/"should work"/"believe correct"/"tests should pass" as terminal, without running test + seeing pass.
