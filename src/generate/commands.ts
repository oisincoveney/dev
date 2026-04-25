/**
 * Generates `.claude/commands/*.md` — single-purpose slash commands.
 *
 * Commands are cheaper than skills for one-shot workflows: no description
 * in the skill budget, they only load when the user types `/<name>`.
 */

import type { DevConfig } from '../config.js'

export interface CommandFile {
  filename: string
  content: string
}

export function generateCommands(config: DevConfig): CommandFile[] {
  const files: CommandFile[] = []
  files.push({ filename: 'verify.md', content: verifyCommand(config) })
  if (config.tools.includes('beads')) {
    files.push({ filename: 'ready.md', content: readyCommand() })
  }
  files.push({ filename: 'spec.md', content: specCommand() })
  files.push({ filename: 'commit.md', content: commitCommand() })
  files.push({ filename: 'research.md', content: researchCommand() })
  files.push({ filename: 'explore.md', content: exploreCommand() })
  files.push({ filename: 'plan.md', content: planCommand() })
  return files
}

function verifyCommand(config: DevConfig): string {
  const { typecheck, lint, test } = config.commands
  return `---
description: Run typecheck, lint, and tests; report pass/fail per step
disable-model-invocation: true
allowed-tools: Bash
---

Run the project's verification chain in order. Stop and report the first failure.

1. Typecheck: \`${typecheck}\`
2. Lint: \`${lint}\`
3. Test: \`${test}\`

After all three pass, state "Verified: typecheck + lint + test green." with the tail of the test output included. If any step fails, show the failing output verbatim and stop — do not attempt a fix unless the user asks.
`
}

function readyCommand(): string {
  return `---
description: Show the top beads ready task with full detail
disable-model-invocation: true
allowed-tools: Bash(bd *)
---

Run \`bd ready\` to list available work, then \`bd show\` on the highest-priority item. Summarize the issue, its dependencies, and the acceptance criteria in under 150 words. Do not claim the task — the user will run \`bd update <id> --claim\` themselves if they want to proceed.
`
}

function specCommand(): string {
  return `---
description: Create a new spec file in .claude/specs/ for the current task
disable-model-invocation: true
allowed-tools: Bash(date *) Write Read
---

Create a new spec at \`.claude/specs/YYYY-MM-DD-$ARGUMENTS.md\` using the TEMPLATE.md in the same directory. Use today's date (from \`date +%Y-%m-%d\`) and the slug passed as \`$ARGUMENTS\`. Fill in the Overview and Success Criteria sections with your best inference from recent conversation, then stop — the user fills in the rest.

If \`$ARGUMENTS\` is empty, ask for a slug (kebab-case) and halt.
`
}

function commitCommand(): string {
  return `---
description: Split current working changes into logical, focused commits
disable-model-invocation: true
allowed-tools: Bash(git *)
---

Split the current working tree into logical commits. Never dump everything into a single commit.

1. Run \`git status\` and \`git diff\` (and \`git diff --cached\`) to review all changes.
2. Group related hunks into logical commits — one concern per commit:
   - feat: new behavior
   - fix: bug fix
   - refactor: structure without behavior change
   - test: tests only
   - docs: documentation
   - chore: tooling, config, formatting
3. For each group, \`git add -p\` or \`git add <specific files>\` — never \`git add -A\`/\`git add .\`.
4. Write a conventional commit message: \`<type>(<scope>): <subject>\` under 70 chars, body explaining WHY not WHAT.
5. Never add Co-Authored-By trailers (blocked by hook).
6. Run \`git log --oneline -10\` after each commit to confirm.

Stop before pushing. The user pushes when they're ready.

If the diff is trivially one concern, one commit is fine — do not invent splits.
`
}

function researchCommand(): string {
  return `---
description: Produce a cited research dossier BEFORE any implementation
disable-model-invocation: true
allowed-tools: WebFetch WebSearch Read Grep Glob Bash
---

Produce a research dossier at \`docs/research/YYYY-MM-DD-$ARGUMENTS.md\` (create the directory if missing). No Edit/Write to source code until the user approves the dossier.

The dossier MUST contain:

1. **Problem statement** — what the user asked, restated in one paragraph.
2. **Current state** — what exists in this repo relevant to the problem, with \`file:line\` references from actual Read/Grep calls this session. No "I believe" or "typically".
3. **External facts** — every API, library, service, or protocol claim links to a primary source fetched via WebFetch in this session. Quote the specific passage that supports each claim.
4. **Environment assumptions** — what you had to ask or check about the user's setup (DNS, auth, deployment targets, package manager, versions). Flag anything unverified.
5. **Options** — at least two concrete approaches, with tradeoffs, and which project conventions each respects/violates (check \`.dev.config.json\`, \`AGENTS.md\`, \`CLAUDE.md\`).
6. **Recommendation** — one option, with explicit risks and unknowns.
7. **Open questions** — anything you could not verify. Do not answer these from training data.

If \`$ARGUMENTS\` is empty, ask for a slug (kebab-case) and halt.

Stop after writing the dossier. Wait for user approval before implementing.
`
}

function exploreCommand(): string {
  return `---
description: Explore and map the code path for a feature or bug — read-only, no edits
disable-model-invocation: true
allowed-tools: Read Grep Glob Bash(rg *) Bash(git log *) Bash(git blame *)
---

Map the code path for \`$ARGUMENTS\` without making any edits. Produce a short report only.

1. Identify entry points (routes, CLI args, public APIs, exported functions) relevant to \`$ARGUMENTS\`.
2. Trace the data flow end-to-end: input → validation → business logic → persistence → output.
3. List every file touched along the path, with a one-line note per file.
4. Note the tests that cover this path (and, honestly, the gaps).
5. Call out any surprises: god-objects, circular deps, silent fallbacks, generated code, TODOs.
6. End with: "Suggested next step: <one sentence>." — do not start implementing.

If \`$ARGUMENTS\` is empty, ask for the feature/bug subject and halt.

Do not edit any files during exploration. If the user tells you to start editing, switch modes explicitly.
`
}

function planCommand(): string {
  return `---
description: Produce a written plan for a multi-file or architectural change; no edits
disable-model-invocation: true
allowed-tools: Read Grep Glob Bash(rg *) Write
---

Write a plan at \`.claude/plans/YYYY-MM-DD-$ARGUMENTS.md\` (create the directory if missing) for the task \`$ARGUMENTS\`. No source-code Edit/Write until the user approves the plan.

The plan MUST contain:

1. **Goal** — one sentence: what the user wants, stated as an outcome.
2. **Root cause / requirement** — why this change, not symptoms.
3. **Files to change** — every file, with a one-line reason per file. If you don't know the file exists, read the tree first.
4. **Order of operations** — which edit happens first, and why that order (e.g., contract before callers, tests before implementation if TDD).
5. **What you verified** — docs read (with URLs), code traced (with \`file:line\`), commands run.
6. **Risks** — what could go wrong, what you'll do to mitigate.
7. **Out of scope** — what this plan will NOT touch, to prevent scope creep.

If \`$ARGUMENTS\` is empty, ask for a slug (kebab-case) and halt.

After writing, print the plan path and stop. Wait for user approval before any code edit.
`
}
