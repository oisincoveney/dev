---
name: testing
description: Test-driven development, co-located tests, property-based testing
---

# Testing

**Test-driven development** (Kent Beck's red/green/refactor):
1. Write a failing test first
2. Write the minimum code to make it pass
3. Refactor for quality — tests keep you safe

**Co-locate tests** with source (e.g., `foo.ts` + `foo.test.ts`).

**Property-based testing** for non-trivial logic — use fast-check (TS), proptest (Rust), rapid (Go) to generate edge cases automatically.

**No deletion to pass**: never delete or weaken a test to make it pass. Fix the code, not the test.

**Mutation testing** measures test quality beyond coverage. Run periodically.

**Proof of work**: Run the test command and show passing output before reporting done. Never write "the tests should pass" — run them and confirm they do.
