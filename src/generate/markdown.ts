/**
 * Generates CLAUDE.md and AGENTS.md content.
 *
 * To keep the root file under 200 lines (Anthropic best practice, context rot
 * research), content is split into multiple files composed via @imports.
 */

import type { DevConfig } from '../config.js'
import type { Answers } from '../prompts.js'
import { RULE_SKILLS } from '../skills.js'

export interface ClaudeMdBundle {
  root: string
  fragments: Record<string, string>
}

/** Entry point for install.ts — returns the root file plus all fragment files. */
export function buildClaudeMdBundle(config: DevConfig, _answers: Answers): ClaudeMdBundle {
  const fragments: Record<string, string> = {
    '.claude/docs/commands.md': commandsBlock(config),
    '.claude/docs/uncertainty.md': hallucinationBlock(),
    '.claude/docs/destructive.md': destructiveBlock(),
    '.claude/docs/workflow.md': workflowBlock(config),
    '.claude/docs/principles.md': principlesBlock(config),
    '.claude/docs/coding-principles.md': karpathyBlock(),
  }

  if (config.tools.includes('beads')) {
    fragments['.claude/docs/beads.md'] = beadsBlock()
  }
  if (config.contractDriven) {
    fragments['.claude/docs/contract-driven.md'] = contractDrivenBlock(config.language)
  }

  const importLines: string[] = ['## Imports', '']
  for (const path of Object.keys(fragments)) {
    importLines.push(`- @${path}`)
  }
  importLines.push('')

  const root = [
    '# Project Instructions for AI Agents',
    '',
    'This project is configured with @oisincoveney/dev. Hooks and configs enforce most rules mechanically. The sub-files below capture the rest.',
    '',
    '## Critical Rules (always active)',
    '',
    '- Use `bd` for ALL task tracking — TodoWrite is blocked by hook',
    '- Never run destructive commands without explicit user approval — blocked by hook',
    '- Read before editing; verify before claiming done',
    '- Confident wrong answers are worse than honest uncertainty — say "I need to verify" and check',
    '- Treat user constraints as non-negotiable; do not reinterpret',
    '- No follow-up questions like "Want me to...". If done, stop.',
    '- Do not write "this works", "this should work", or "done" without having run the test command and seen passing output. The Stop hook checks the session transcript — it will block you if you claim completion without evidence.',
    '',
    importLines.join('\n'),
  ].join('\n')

  return { root, fragments }
}

/** Back-compat: flat markdown for callers that want a single string. */
export function generateClaudeMd(config: DevConfig, answers: Answers): string {
  const bundle = buildClaudeMdBundle(config, answers)
  return [bundle.root, ...Object.values(bundle.fragments)].join('\n\n')
}

function commandsBlock(config: DevConfig): string {
  const e2eLine = config.commands.e2e ? `\ne2e:       ${config.commands.e2e}` : ''
  return `## Commands

\`\`\`
dev:       ${config.commands.dev}
build:     ${config.commands.build}
test:      ${config.commands.test}
typecheck: ${config.commands.typecheck}
lint:      ${config.commands.lint}
format:    ${config.commands.format}${e2eLine}
\`\`\`

Use these exact commands. Do not guess alternatives like \`docker compose up\`, \`npm start\`, etc.
`
}

function workflowBlock(config: DevConfig): string {
  if (config.workflow === 'idd') return iddBlock()
  if (config.workflow === 'gsd') return gsdBlock()
  return plainSpecBlock()
}

function principlesBlock(config: DevConfig): string {
  const selectedRules = RULE_SKILLS.filter((skill) => config.skills.includes(skill.id))
  return selectedRules.map((r) => r.markdownSection).join('\n')
}

function beadsBlock(): string {
  return `## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run \`bd prime\` to see the full workflow.

\`\`\`bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
\`\`\`

**Rules:**
- Use \`bd\` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists (blocked by hook)
- Use \`bd remember\` for persistent knowledge — do NOT use MEMORY.md files
`
}

function iddBlock(): string {
  return `## Workflow: Intent-Driven Development (IDD)

**Core tagline:** Humans define WHAT and WHY. AI determines HOW and WHEN.

**The workflow:**
\`\`\`
Intent → Tests → Code → Sync
\`\`\`

1. **Intent**: Write a short, high-level intent doc in \`.claude/specs/YYYY-MM-DD-<slug>.md\`. Focus on WHAT and WHY, not implementation detail.
2. **Tests**: Write tests that verify the intent (behavior, not implementation).
3. **Code**: Implement the minimum needed to satisfy the tests. Trust the AI to resolve ambiguities.
4. **Sync**: If code drifts from intent, update the intent first. Intent is source of truth, code is output.

**When to write a spec:** Any task larger than a single-file change.
`
}

function gsdBlock(): string {
  return `## Workflow: Get Shit Done (GSD)

**Core insight:** Context rot degrades AI output quality as the window fills. GSD forces clean context windows per phase.

**The 6-phase cycle:**
1. **New Project** — clean context window, state goal
2. **Discuss** — clarify requirements before planning
3. **Plan** — produce a structured plan doc in \`.claude/specs/\`
4. **Execute** — implement the plan in atomic commits
5. **Verify** — run tests, lint, build; verify the work matches the plan
6. **Complete Milestone** — commit, push, and clear context for next task

**Rules:**
- Start each major feature with a fresh context window
- Never skip the Discuss → Plan phases for non-trivial work
- Atomic commits per task in the plan
`
}

function plainSpecBlock(): string {
  return `## Workflow: Lightweight Specs

For any task larger than a single-file change, create a spec in \`.claude/specs/YYYY-MM-DD-<slug>.md\` using the template. The spec must have explicit success criteria before implementation begins.

Reference the spec in commits: "Implements per specs/2026-04-13-<slug>.md".
`
}

function contractDrivenBlock(language: 'typescript' | 'rust' | 'go'): string {
  const examples: Record<typeof language, string> = {
    typescript: `src/modules/trip/
  index.ts          # Public interface — the ONLY thing other modules import
  trip.ts           # Implementation (internal)
  trip.contract.ts  # Type contract: exported types, invariants, pre/postconditions
  trip.test.ts      # Tests that verify the contract`,
    rust: `src/trip/
  mod.rs            # Public interface with \`pub\` items
  internal.rs       # pub(crate) implementation details
  tests.rs          # Integration tests for the contract`,
    go: `internal/trip/
  trip.go           # Public types and interfaces (exported)
  internal.go       # unexported helpers
  trip_test.go      # Tests that verify the contract`,
  }

  return `## Contract-Driven Modules

Every module has an explicit contract file defining:
- Exported types (what callers see)
- Pre/postconditions (in docstrings)
- Invariants (what must always be true)
- Example usage (executable via test runner)

**Structure:**
\`\`\`
${examples[language]}
\`\`\`

**Rules:**
- Never import from another module's internals. Only import from its public interface.
- Before adding behavior to a module, update its contract first.
- Changing a module's public contract is a breaking change — bump the version and document it.
`
}

function hallucinationBlock(): string {
  return `## Uncertainty and Verification

When you are about to write code that uses an external API, library function, or package feature you haven't verified in THIS session, you MUST:

1. Say explicitly: "I need to verify <X>"
2. Use Read/Grep/Glob to check the actual source or installed package
3. If the tool confirms it exists, proceed
4. If it doesn't exist, say so and ask OR use the actual API

Never state an API exists based on training data alone. Verify or abstain.
Confident wrong answers are worse than honest uncertainty.

**Specific forbidden patterns:**
- Writing \`import { foo } from 'pkg'\` without verifying foo is exported by pkg (blocked by hook)
- Calling \`lib.method()\` without confirming method exists in the installed version
- Referencing filesystem paths, env vars, or config keys without reading the actual file
- Citing documentation claims without having read the docs in this session
- Saying "this works", "this should work", "I believe this is correct", or "the tests should pass" as a terminal statement without having run the test command and seen passing output
`
}

function karpathyBlock(): string {
  return `## Coding Principles

**Think Before Coding**

State your assumptions explicitly before writing code. If uncertain about requirements, ask. Don't hide confusion or silently choose between interpretations — surface tradeoffs and present alternatives.

**Simplicity First**

Write the minimum code that solves the problem. Nothing speculative. No unrequested features, no premature abstractions, no unnecessary configurability. If you wrote 200 lines and it could be 50, rewrite it. A senior engineer should not find the solution overcomplicated.

**Surgical Changes**

Touch only what the task requires. Every modified line should directly address the request. Don't clean up unrelated code, don't refactor functioning code, don't improve surrounding style. Match existing conventions.

**Goal-Driven Execution**

Before coding, state the explicit success criteria. Define what "done" looks like in testable terms. After implementing, verify against those criteria — run the test command, check the output, confirm the goal is met. Loop until verified, not until it looks right.
`
}

function destructiveBlock(): string {
  return `## Destructive Operations

The following are blocked by hooks. Never attempt them without explicit user approval:
- \`git reset --hard\`
- \`git push --force\` / \`git push -f\`
- \`git clean -f\`
- \`rm -rf\`
- \`DROP TABLE\` / \`DROP DATABASE\`
- \`npm publish\` / \`yarn publish\` / \`bun publish\` / \`pnpm publish\`

For destructive operations the user has explicitly authorized, ask before each occurrence, not once for a session.

**No Co-Authored-By**: Do not add \`Co-Authored-By: Claude\` to commit messages. Stripped automatically by hook.
`
}
