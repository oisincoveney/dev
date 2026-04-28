/**
 * Generates `.claude/rules/*.md` — the primary Claude Code context channel.
 *
 * Two kinds of rules:
 * 1. Static rules — copied verbatim from `templates/rules/<id>.md`.
 *    Frontmatter in the source controls Claude's runtime scoping (paths, description).
 * 2. Dynamic rules — built from `DevConfig` (commands, workflow, beads, contract-driven).
 */

import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import type { DevConfig, Language } from '../config.js'
import { RULE_SKILLS } from '../skills.js'

export interface RuleFile {
  filename: string
  content: string
}

/**
 * @param templatesDir — absolute path to the package's `templates/` directory.
 *   Passed in from install.ts (which resolves it correctly for both source and
 *   bundled execution). The `skill.sourceFile` is `templates/rules/<id>.md`;
 *   we rebase it onto the real templates dir.
 */
export function generateRules(config: DevConfig, templatesDir: string): RuleFile[] {
  const files: RuleFile[] = []

  // 1. Static rule files from templates/rules/ — filter by selected skills.
  for (const skill of RULE_SKILLS) {
    if (!config.skills.includes(skill.id)) continue
    const source = resolve(templatesDir, 'rules', basename(skill.sourceFile))
    const content = readFileSync(source, 'utf8')
    files.push({ filename: `${skill.id}.md`, content })
  }

  // 2. Dynamic rule files built from config.
  files.push({ filename: 'commands.md', content: commandsRule(config) })
  files.push({ filename: 'workflow.md', content: workflowRule(config) })

  if (config.tools.includes('beads')) {
    files.push({ filename: 'beads.md', content: beadsRule() })
    files.push({
      filename: 'planning-ux.md',
      content: readFileSync(resolve(templatesDir, 'rules', 'planning-ux.md'), 'utf8'),
    })
  }
  if (config.contractDriven) {
    files.push({ filename: 'contract-driven.md', content: contractDrivenRule(config.language) })
  }

  return files
}

function commandsRule(config: DevConfig): string {
  const header = `---
name: commands
description: Canonical build/test/lint commands for this project
---

# Commands
`

  const entries: Array<[string, string | null | undefined]> = [
    ['dev', config.commands.dev],
    ['build', config.commands.build],
    ['test', config.commands.test],
    ['typecheck', config.commands.typecheck],
    ['lint', config.commands.lint],
    ['format', config.commands.format],
    ['e2e', config.commands.e2e],
  ]
  const rendered = entries
    .filter(([, value]) => typeof value === 'string' && value.length > 0)
    .map(([key, value]) => `${`${key}:`.padEnd(11)}${value as string}`)

  if (rendered.length === 0) {
    return `${header}
Commands are not set yet. Run \`oisin-dev set-commands\` once you know the dev/build/test commands for this project.
`
  }

  return `${header}
\`\`\`
${rendered.join('\n')}
\`\`\`

Use these exact commands. Do not guess alternatives like \`docker compose up\`, \`npm start\`, etc.
`
}

function workflowRule(config: DevConfig): string {
  const header = `---
name: workflow
description: Workflow methodology for this project
---

`
  if ((config.workflow as string) === 'bd') return header + bdBody()
  return header + plainSpecBody()
}

function bdBody(): string {
  return `# Workflow: bd is the source of truth

All specs, plans, research, decisions, and acceptance criteria live in bd.
Never write standalone markdown files for these — no on-disk
spec / plan / research / ADR directories.

## The loop (one ticket per session)

1. \`/epic <slug>\` — drafts an EARS-format epic body and creates the bd
   epic + child tickets via \`bd create\`.
2. \`/work-next\` — \`bd ready --json\` picks the highest-priority unblocked
   issue, runs \`bd update <id> --claim\`, and echoes the acceptance criteria.
3. **TDD** — write failing test → make it pass → refactor. Enforced by
   \`tdd-guard.sh\` at the lefthook layer.
4. \`/verify-spec <id>\` — fresh-context subagent re-reads the bd issue,
   runs each Verification Command, returns PASS/FAIL/PARTIAL.
5. \`bd close <id> --reason "<why>" --suggest-next\` — only after PASS.
6. **Discoveries** — \`/discover <description>\` creates a child issue
   with \`--deps=discovered-from:<current>\`. Never expand scope silently.

## Other artifacts

- **Plans** — \`/plan <id>\` writes to the issue's \`--design\` field.
- **Research** — \`/research <topic>\` either \`bd remember\` (cross-session
  knowledge) or \`bd create --type=spike\` (issue-bound research).
- **Decisions / ADRs** — \`/decision <topic>\` runs \`bd decision record\`.
- **Hygiene** — \`/bd-hygiene\` runs \`bd doctor\`, \`bd stale\`, \`bd lint\`,
  \`bd count --status open\` (Yegge: keep ≤200 open).

Reference issues in commits: \`Implements bd-XXXX\`. No spec paths in commit
messages — the bd ID resolves.
`
}

function plainSpecBody(): string {
  return `# Workflow: Lightweight

For any task larger than a single-file change, write down explicit success
criteria before implementation begins. Reference the criteria in commits.

If beads is enabled, switch \`workflow\` to \`bd\` in \`.dev.config.json\` to
get the full bd-native loop.
`
}

function beadsRule(): string {
  return `---
name: beads
description: Task tracking via beads (bd) — required, TodoWrite is blocked
---

# Beads Issue Tracker

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

function contractDrivenRule(language: Language): string {
  const structureByLanguage: Record<string, string> = {
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
    swift: `Sources/Trip/
  Trip.swift        # Public types + contract doc comments
  TripStore.swift   # internal implementation (not exported)
Tests/TripTests/
  TripTests.swift   # Tests that verify the contract`,
    other: `trip/
  interface         # Public surface — the only thing consumers use
  internal          # Implementation details (unexported/private)
  tests             # Tests that verify the contract`,
  }

  const pathsByLanguage: Record<string, string[]> = {
    typescript: ['src/**/*.ts', 'src/**/*.tsx'],
    rust: ['src/**/*.rs'],
    go: ['**/*.go'],
    swift: ['Sources/**/*.swift'],
    other: ['src/**/*'],
  }

  const paths = pathsByLanguage[language] ?? ['src/**/*']
  const pathsYaml = paths.map((p) => `  - "${p}"`).join('\n')

  return `---
name: contract-driven
description: Module contract pattern — public interface vs internals, breaking-change discipline
paths:
${pathsYaml}
---

# Contract-Driven Modules

Every module has an explicit contract file defining:
- Exported types (what callers see)
- Pre/postconditions (in docstrings)
- Invariants (what must always be true)
- Example usage (executable via test runner)

**Structure:**
\`\`\`
${structureByLanguage[language]}
\`\`\`

**Rules:**
- Never import from another module's internals. Only import from its public interface.
- Before adding behavior to a module, update its contract first.
- Changing a module's public contract is a breaking change — bump the version and document it.
`
}
