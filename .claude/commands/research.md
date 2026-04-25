---
description: Produce a cited research dossier BEFORE any implementation
disable-model-invocation: true
allowed-tools: WebFetch WebSearch Read Grep Glob Bash
---

Produce a research dossier at `docs/research/YYYY-MM-DD-$ARGUMENTS.md` (create the directory if missing). No Edit/Write to source code until the user approves the dossier.

The dossier MUST contain:

1. **Problem statement** — what the user asked, restated in one paragraph.
2. **Current state** — what exists in this repo relevant to the problem, with `file:line` references from actual Read/Grep calls this session. No "I believe" or "typically".
3. **External facts** — every API, library, service, or protocol claim links to a primary source fetched via WebFetch in this session. Quote the specific passage that supports each claim.
4. **Environment assumptions** — what you had to ask or check about the user's setup (DNS, auth, deployment targets, package manager, versions). Flag anything unverified.
5. **Options** — at least two concrete approaches, with tradeoffs, and which project conventions each respects/violates (check `.dev.config.json`, `AGENTS.md`, `CLAUDE.md`).
6. **Recommendation** — one option, with explicit risks and unknowns.
7. **Open questions** — anything you could not verify. Do not answer these from training data.

If `$ARGUMENTS` is empty, ask for a slug (kebab-case) and halt.

Stop after writing the dossier. Wait for user approval before implementing.
