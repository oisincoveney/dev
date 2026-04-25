---
description: Explore and map the code path for a feature or bug — read-only, no edits
disable-model-invocation: true
allowed-tools: Read Grep Glob Bash(rg *) Bash(git log *) Bash(git blame *)
---

Map the code path for `$ARGUMENTS` without making any edits. Produce a short report only.

1. Identify entry points (routes, CLI args, public APIs, exported functions) relevant to `$ARGUMENTS`.
2. Trace the data flow end-to-end: input → validation → business logic → persistence → output.
3. List every file touched along the path, with a one-line note per file.
4. Note the tests that cover this path (and, honestly, the gaps).
5. Call out any surprises: god-objects, circular deps, silent fallbacks, generated code, TODOs.
6. End with: "Suggested next step: <one sentence>." — do not start implementing.

If `$ARGUMENTS` is empty, ask for the feature/bug subject and halt.

Do not edit any files during exploration. If the user tells you to start editing, switch modes explicitly.
