---
name: grill-me
description: Interview the user relentlessly about a plan or design until reaching shared understanding, resolving each branch of the decision tree. Use when user wants to stress-test a plan, get grilled on their design, or mentions "grill me".
---

<!--
Vendored from https://github.com/mattpocock/skills/tree/main/grill-me (MIT, Copyright (c) 2026 Matt Pocock).
See LICENSE in this directory for the full notice.
-->

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time.

If a question can be answered by exploring the codebase, explore the codebase instead.

## Pre-grill: load prior rejection context

If this grill follows a `/regrill <id>` or `/reject <id>`, prior rejection cause may be recorded in beads memory. Check:

```bash
bd memories "plan-rejected:" 2>/dev/null
```

If matches present, read the most recent. Use as seed: don't repeat the question that already got a "no" answer; lead with the rejected angle ("you said X is out — should we revise around X, or restart?").
