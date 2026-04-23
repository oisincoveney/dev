---
description: Run typecheck, lint, and tests; report pass/fail per step
disable-model-invocation: true
allowed-tools: Bash
---

Run the project's verification chain in order. Stop and report the first failure.

1. Typecheck: `tsc --noEmit`
2. Lint: `echo "no lint configured"`
3. Test: `bun test`

After all three pass, state "Verified: typecheck + lint + test green." with the tail of the test output included. If any step fails, show the failing output verbatim and stop — do not attempt a fix unless the user asks.
