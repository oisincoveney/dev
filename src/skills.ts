/**
 * Skill registry — maps skill IDs to metadata.
 *
 * "Skills" here means two distinct things:
 * 1. Rule categories (sections written into CLAUDE.md/AGENTS.md/.cursor/rules)
 * 2. Existing Claude Code skills from ~/.agents/skills/ to copy project-local
 *
 * This registry covers both.
 */

export type SkillCategory = 'rule' | 'superpower'

export interface RuleSkill {
  id: string
  kind: 'rule'
  name: string
  description: string
  appliesTo: ReadonlyArray<ProjectVariant>
  markdownSection: string
}

export interface SuperpowerSkill {
  id: string
  kind: 'superpower'
  name: string
  description: string
  appliesTo: ReadonlyArray<ProjectVariant>
}

export type Skill = RuleSkill | SuperpowerSkill

export type ProjectVariant =
  | 'ts-frontend'
  | 'ts-backend'
  | 'ts-fullstack'
  | 'ts-library'
  | 'ts-monorepo'
  | 'rust-bin'
  | 'rust-lib'
  | 'rust-workspace'
  | 'go-bin'
  | 'go-lib'
  | 'go-workspace'

const ALL_VARIANTS: ReadonlyArray<ProjectVariant> = [
  'ts-frontend',
  'ts-backend',
  'ts-fullstack',
  'ts-library',
  'ts-monorepo',
  'rust-bin',
  'rust-lib',
  'rust-workspace',
  'go-bin',
  'go-lib',
  'go-workspace',
]

const TS_VARIANTS: ReadonlyArray<ProjectVariant> = [
  'ts-frontend',
  'ts-backend',
  'ts-fullstack',
  'ts-library',
  'ts-monorepo',
]

const TS_FRONTEND_VARIANTS: ReadonlyArray<ProjectVariant> = ['ts-frontend', 'ts-fullstack']

// Rule-category skills (become CLAUDE.md sections and .cursor/rules/*.mdc files)
export const RULE_SKILLS: ReadonlyArray<RuleSkill> = [
  {
    id: 'code-quality',
    kind: 'rule',
    name: 'Code Quality & Strictness',
    description: 'Strict type systems, no hacks, meaningful names, early returns',
    appliesTo: ALL_VARIANTS,
    markdownSection: `## Code Quality & Strictness

- No \`any\` / no raw error suppression (@ts-ignore, unwrap, ignored errors)
- No magic numbers — extract to named constants
- Early returns over nested conditionals
- Meaningful names — no generic terms like \`data\`, \`info\`, \`item\`, \`manager\`, \`handler\`, \`util\`, \`helper\`, \`tmp\`
- No abbreviations unless universal (id, url, db)
- DRY at 2 occurrences — if you write it twice, extract it
`,
  },
  {
    id: 'architecture',
    kind: 'rule',
    name: 'Architecture (Deep Modules, File Limits)',
    description: 'Ousterhout deep modules, clean architecture layers, file size limits',
    appliesTo: ALL_VARIANTS,
    markdownSection: `## Architecture

**Deep modules over shallow ones** (Ousterhout):
- A module's interface should be much simpler than its implementation
- Information hiding is the goal — hide complexity behind simple APIs
- Red flags: pass-through methods, shallow modules that leak implementation details

**Layer discipline** (Clean Architecture):
- Domain/core layer cannot import from infrastructure/framework layer
- Dependencies point inward toward the core
- Enforced by dependency-cruiser (TS) or depguard (Go) or crate boundaries (Rust)

**File size limits**: max 300 lines per file, max 50 lines per function. Split if exceeded.

**Folder naming**: kebab-case for all folder names.
`,
  },
  {
    id: 'testing',
    kind: 'rule',
    name: 'Testing (TDD)',
    description: 'Test-driven development, co-located tests, property-based testing',
    appliesTo: ALL_VARIANTS,
    markdownSection: `## Testing

**Test-driven development** (Kent Beck's red/green/refactor):
1. Write a failing test first
2. Write the minimum code to make it pass
3. Refactor for quality — tests keep you safe

**Co-locate tests** with source (e.g., \`foo.ts\` + \`foo.test.ts\`).

**Property-based testing** for non-trivial logic — use fast-check (TS), proptest (Rust), rapid (Go) to generate edge cases automatically.

**No deletion to pass**: never delete or weaken a test to make it pass. Fix the code, not the test.

**Mutation testing** measures test quality beyond coverage. Run periodically.

**Proof of work**: Run the test command and show passing output before reporting done. Never write "the tests should pass" — run them and confirm they do.
`,
  },
  {
    id: 'ai-behavior',
    kind: 'rule',
    name: 'AI Behavior & Principles',
    description: 'Uncertainty, no follow-up questions, constraints as hard requirements',
    appliesTo: ALL_VARIANTS,
    markdownSection: `## AI Behavior

**Uncertainty & Verification**

When you're about to write code that uses an external API, library function, or package feature you haven't verified in THIS session, you MUST:
1. Say explicitly: "I need to verify <X>"
2. Use Read/Grep/Glob to check the actual source or installed package
3. If confirmed, proceed; if not, ask or use the actual API

Never state an API exists based on training data alone. Verify or abstain. Confident wrong answers are worse than honest uncertainty.

**No completion claims without proof**: Never write "this works", "this should work", or "tests should pass" as a terminal statement. Run the test command, observe the output, include it in your response. The Stop hook checks the session transcript — it will block you if you claim completion without evidence.

**User Constraints Are Hard Requirements**

When the user gives explicit constraints ("use X", "don't do Y", "no Z"), those are non-negotiable. Do not reinterpret, simplify, or substitute. If a constraint is unclear, ask ONCE. Otherwise follow it exactly.

**No Follow-Up Questions**

Do not end responses with "Want me to...", "Should I also...", or similar follow-up prompts. If the work is done, state what changed and stop. If there's genuine ambiguity about next steps, name the specific decision rather than open-ended questions.

**Read Before Editing**

Before modifying any non-trivial code, trace the full data flow. Don't apply frontend band-aids when the root cause is backend (or vice versa).

**No Destructive Operations Without Permission**

Never run \`git reset --hard\`, \`rm -rf\`, \`git push --force\`, \`DROP TABLE\`, or publish commands without explicit user approval.

**No Co-Authored-By**

Do not add "Co-Authored-By: Claude" to commit messages.
`,
  },
  {
    id: 'component-patterns',
    kind: 'rule',
    name: 'Component Patterns',
    description: 'Function components, Props interfaces, no prop drilling',
    appliesTo: TS_FRONTEND_VARIANTS,
    markdownSection: `## Component Patterns

- Function components only, no classes
- Every component has an explicit Props interface
- No prop drilling — children pull state from atoms/stores
- Pages are layout shells, not data passers
- Error boundaries on every route
`,
  },
  {
    id: 'state-management',
    kind: 'rule',
    name: 'State Management',
    description: 'Jotai atoms, no createContext, feature-scoped stores',
    appliesTo: TS_FRONTEND_VARIANTS,
    markdownSection: `## State Management

- No \`createContext\` — use Jotai atoms
- \`useState\` only for simple local UI state (open/closed, hover)
- \`useRef\` only for DOM refs and library integration
- Feature atoms live in \`feature/store/\`
- Cross-feature communication via shared atoms or events
`,
  },
  {
    id: 'styling-ui',
    kind: 'rule',
    name: 'Styling & UI',
    description: 'Tailwind, shadcn primitives, design tokens',
    appliesTo: TS_FRONTEND_VARIANTS,
    markdownSection: `## Styling & UI

- Use shadcn/ui primitives with defaults — never override unless required
- No arbitrary Tailwind values (\`w-[347px]\`) — use theme tokens
- No color-specific classes (\`bg-blue-500\`) — use design tokens (\`bg-primary\`)
- No inline styles (\`style={{}}\`) — use Tailwind
- No className concatenation — use \`cn()\` or \`clsx()\`
- No className soup: 1-3 utility classes per element, not 20+
- No empty \`<div>\` or \`<span>\` elements
- Semantic HTML everywhere
`,
  },
  {
    id: 'performance',
    kind: 'rule',
    name: 'Performance',
    description: 'Fine-grained subscriptions, stable references, lazy loading',
    appliesTo: ALL_VARIANTS,
    markdownSection: `## Performance

- Avoid inline arrow functions in hot paths — extract to named functions
- Avoid inline object/array literals in props — extract to variables
- Stable references for callbacks
- Keys: stable unique identifiers, never array indices
- Lazy load routes and heavy components
`,
  },
  {
    id: 'forms-data',
    kind: 'rule',
    name: 'Forms & Data',
    description: 'Schema validation, typed APIs, i18n-ready strings',
    appliesTo: TS_FRONTEND_VARIANTS,
    markdownSection: `## Forms & Data

- Framework-native form handling + Zod (or effect/schema) validation
- All APIs must be typed
- Validate at system boundaries (user input, external APIs)
- All user-facing strings must be i18n-ready
`,
  },
]

// Superpower skills — existing skills in ~/.agents/skills/ to copy into .claude/skills/
export const SUPERPOWER_SKILLS: ReadonlyArray<SuperpowerSkill> = [
  {
    id: 'using-superpowers',
    kind: 'superpower',
    name: 'using-superpowers',
    description: 'Meta-skill that forces Claude to invoke relevant skills',
    appliesTo: ALL_VARIANTS,
  },
  {
    id: 'debug',
    kind: 'superpower',
    name: 'debug',
    description: 'Structured debugging session',
    appliesTo: ALL_VARIANTS,
  },
  {
    id: 'code-review',
    kind: 'superpower',
    name: 'code-review',
    description: 'Security, performance, correctness review',
    appliesTo: ALL_VARIANTS,
  },
  {
    id: 'architecture',
    kind: 'superpower',
    name: 'architecture',
    description: 'Architecture decision records',
    appliesTo: ALL_VARIANTS,
  },
  {
    id: 'system-design',
    kind: 'superpower',
    name: 'system-design',
    description: 'Services, APIs, data modeling',
    appliesTo: ALL_VARIANTS,
  },
  {
    id: 'testing-strategy',
    kind: 'superpower',
    name: 'testing-strategy',
    description: 'Test plans and approaches',
    appliesTo: ALL_VARIANTS,
  },
  {
    id: 'tech-debt',
    kind: 'superpower',
    name: 'tech-debt',
    description: 'Identify, categorize, prioritize tech debt',
    appliesTo: ALL_VARIANTS,
  },
  {
    id: 'deploy-checklist',
    kind: 'superpower',
    name: 'deploy-checklist',
    description: 'Pre-deployment verification',
    appliesTo: ALL_VARIANTS,
  },
  {
    id: 'documentation',
    kind: 'superpower',
    name: 'documentation',
    description: 'Technical documentation',
    appliesTo: ALL_VARIANTS,
  },
  {
    id: 'write-spec',
    kind: 'superpower',
    name: 'write-spec',
    description: 'Feature specs and PRDs',
    appliesTo: ALL_VARIANTS,
  },
  {
    id: 'product-brainstorming',
    kind: 'superpower',
    name: 'product-brainstorming',
    description: 'Product ideation',
    appliesTo: ALL_VARIANTS,
  },
  {
    id: 'sprint-planning',
    kind: 'superpower',
    name: 'sprint-planning',
    description: 'Sprint scoping',
    appliesTo: ALL_VARIANTS,
  },
  {
    id: 'incident-response',
    kind: 'superpower',
    name: 'incident-response',
    description: 'When things break',
    appliesTo: ALL_VARIANTS,
  },
  {
    id: 'runbook',
    kind: 'superpower',
    name: 'runbook',
    description: 'Operational runbooks',
    appliesTo: ALL_VARIANTS,
  },
  {
    id: 'find-skills',
    kind: 'superpower',
    name: 'find-skills',
    description: 'Discover more skills',
    appliesTo: ALL_VARIANTS,
  },
  {
    id: 'frontend-design',
    kind: 'superpower',
    name: 'frontend-design',
    description: 'Production-grade UI',
    appliesTo: TS_FRONTEND_VARIANTS,
  },
  {
    id: 'design-system',
    kind: 'superpower',
    name: 'design-system',
    description: 'Audit/extend design system',
    appliesTo: TS_FRONTEND_VARIANTS,
  },
  {
    id: 'design-critique',
    kind: 'superpower',
    name: 'design-critique',
    description: 'Usability feedback',
    appliesTo: TS_FRONTEND_VARIANTS,
  },
  {
    id: 'accessibility-review',
    kind: 'superpower',
    name: 'accessibility-review',
    description: 'WCAG audit',
    appliesTo: TS_FRONTEND_VARIANTS,
  },
  {
    id: 'ux-copy',
    kind: 'superpower',
    name: 'ux-copy',
    description: 'Microcopy and error messages',
    appliesTo: TS_FRONTEND_VARIANTS,
  },
  {
    id: 'vercel-react-best-practices',
    kind: 'superpower',
    name: 'vercel-react-best-practices',
    description: 'React/Next.js performance',
    appliesTo: TS_FRONTEND_VARIANTS,
  },
  {
    id: 'sql-queries',
    kind: 'superpower',
    name: 'sql-queries',
    description: 'SQL across warehouses',
    appliesTo: ['ts-backend', 'ts-fullstack', 'rust-bin', 'go-bin'],
  },
]

export const ALL_SKILLS: ReadonlyArray<Skill> = [...RULE_SKILLS, ...SUPERPOWER_SKILLS]

export function skillsForVariant(variant: ProjectVariant): ReadonlyArray<Skill> {
  return ALL_SKILLS.filter((skill) => skill.appliesTo.includes(variant))
}

export function ruleSkillsForVariant(variant: ProjectVariant): ReadonlyArray<RuleSkill> {
  return RULE_SKILLS.filter((skill) => skill.appliesTo.includes(variant))
}

export function superpowerSkillsForVariant(
  variant: ProjectVariant,
): ReadonlyArray<SuperpowerSkill> {
  return SUPERPOWER_SKILLS.filter((skill) => skill.appliesTo.includes(variant))
}
