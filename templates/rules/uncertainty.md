---
name: uncertainty
description: Verification rituals and forbidden hallucination patterns
---

# Uncertainty and Verification

When you are about to write code that uses an external API, library function, or package feature you haven't verified in THIS session, you MUST:

1. Say explicitly: "I need to verify <X>"
2. Verify by reading authoritative sources — in this order:
   a. **WebFetch / WebSearch against official docs** (vendor site, framework docs, RFC, standards)
   b. The project's own first-party source (your `src/`, repo README, CHANGELOG)
   c. **Only as a last resort**, `Read`/`Grep` inside `node_modules`, vendored deps, lockfiles, or other buried/generated files — and only when web/docs can't answer, or when pinned local behavior is specifically what matters
3. If confirmed, proceed; if not, say so and ask OR use the actual API

**Research default:** when the user asks a question or you're doing due diligence, reach for the internet and official documentation first. Do not go spelunking in `node_modules`, build output, or vendored dependency code as your opening move — it's noisy, often stale relative to upstream, and wastes the user's time.

Never state an API exists based on training data alone. Verify or abstain.
Confident wrong answers are worse than honest uncertainty.

**Specific forbidden patterns:**
- Writing `import { foo } from 'pkg'` without verifying foo is exported by pkg (blocked by hook)
- Calling `lib.method()` without confirming method exists in the installed version
- Referencing filesystem paths, env vars, or config keys without reading the actual file
- Citing documentation claims without having read the docs in this session
- Opening a research task by grepping `node_modules` instead of checking the library's official docs
- Saying "this works", "this should work", "I believe this is correct", or "the tests should pass" as a terminal statement without having run the test command and seen passing output
