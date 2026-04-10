# Coding Standards

These rules are mandatory. Rules marked ⛔ are enforced by automated hooks — your Write/Edit will be blocked if you violate them. Rules marked 📋 require your judgment and are not mechanically enforced.

---

## TypeScript Strictness

- ⛔ NEVER use the `any` type. Use `unknown` and narrow, or use proper generics.
- ⛔ NEVER use type assertions (`as X`) without a justifying comment on the same line.
- ⛔ NEVER use non-null assertions (`!`). Use proper null checks or optional chaining.
- ⛔ NEVER use `@ts-ignore` or `@ts-expect-error`. Fix the type error properly.
- ⛔ NEVER access `process.env` or `import.meta.env` directly. Use a Zod-validated env schema.
- 📋 ALWAYS use utility types (`Pick`, `Omit`, indexed access like `App['id']`) instead of widening to primitives. If a prop is an app's ID, type it as `App['id']`, not `string`.
- 📋 ALWAYS use Zod schemas for runtime validation. Derive types with `z.infer<typeof schema>`.
- 📋 tsconfig must use maximum strictness.

## Component Patterns

- ⛔ NEVER use class components. Function components only.
- ⚠️ Every component SHOULD have an explicit Props interface (warned if missing).
- 📋 NEVER prop drill. Children pull their own state from Jotai atoms. Pages are layout shells — they do NOT pass data to children.
- 📋 Error boundaries REQUIRED on every route/page.
- 📋 Modular, composable code. Sensibly named hooks and components.

## State Management

- ⛔ NEVER use `createContext`. Use Jotai atoms.
- ⚠️ `useState` — only for simple local UI state (open/closed, hover). Prefer Jotai atoms for anything shared or complex.
- ⚠️ `useRef` — ONLY for DOM refs and library integration. Never for storing data across renders.
- 📋 Jotai atoms for services (dependency injection).
- 📋 Feature-scoped atoms co-located in `feature/store/`.
- 📋 Cross-feature communication via shared atoms or events.
- 📋 Lean towards event-driven communication between features.

## Store Pattern

- ⛔ Feature store files MUST be one of: `atoms.ts`, `families.ts`, `actions.ts`, `listeners.ts`, `handlers.ts`, `types.ts`, `index.ts`.
- ⛔ Store naming conventions:
  - atoms.ts exports: `*Atom` (e.g., `projectsAtom`)
  - families.ts exports: `*AtomFamily` (e.g., `threadAtomFamily`)
  - actions.ts exports: `do*Atom` (e.g., `doSwitchThreadAtom`)
  - listeners.ts exports: `use*Listeners` (e.g., `useThreadStoreListeners`)
  - handlers.ts exports: `create*Handlers` (e.g., `createThreadHandlers`)

## Architecture

- ⛔ Max 300 lines per file. Split if exceeded.
- ⛔ kebab-case for ALL folder names.
- ⛔ Infrastructure (`ws/`, `infrastructure/`) is READ-ONLY. Do not modify without explicit approval.
- ⛔ Do NOT create new files in `components/ui/` without explicit approval.
- 📋 Feature-first: `features/{name}/` with `store/`, `components/`, `hooks/`, `types.ts`.
- 📋 Shared UI in `components/ui/` (ShadCN primitives only).
- 📋 Global hooks in `hooks/`, utilities in `lib/`.
- 📋 Routing must be modular by page.
- 📋 Effect library encouraged.

## Styling & UI

- ⛔ No inline styles (`style={{}}`). Use Tailwind.
- ⛔ No arbitrary Tailwind values (bracket syntax like `w-[347px]`). Use theme tokens.
- ⛔ No color-specific Tailwind classes (`bg-blue-500`). Use design tokens.
- ⛔ No className string concatenation. Use `cn()` or `clsx()`.
- ⛔ No `<img>` for SVG icons. Import SVGs as components.
- ⛔ No JS animation libraries. CSS/Tailwind transitions only.
- ⛔ No arbitrary z-index. Use Tailwind `z-*` scale.
- ⛔ No empty `<div>` or `<span>` elements.
- ⚠️ Long className strings (>120 chars) should be extracted.
- 📋 Tailwind for layout only. No custom styling unless explicitly requested.
- 📋 ShadCN components are pre-styled. Don't override unless asked.
- 📋 Never create new base UI components without approval.
- 📋 Lazy load images with `loading="lazy"` and explicit dimensions.
- 📋 Semantic HTML everywhere.

## Code Quality

- ⛔ No `export default`. Named exports only.
- ⛔ No `console.log`. Use structured logging. `console.warn`/`console.error` OK.
- ⛔ No nested ternaries. Use early returns or if/else.
- ⛔ No hardcoded URLs, localhost, or API keys. Use env vars.
- 📋 No magic numbers. Extract non-obvious constants.
- 📋 DRY at 2 occurrences. If you write it twice, extract it.
- 📋 Early returns over nested conditionals.
- 📋 `on*` for callback props, `handle*` for internal handlers.
- 📋 Conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`.

## Testing

- ⚠️ Tests required for new components/functions (warned if missing).
- 📋 Vitest for unit/integration, Playwright for E2E.
- 📋 Tests co-located with source: `Foo.test.tsx` next to `Foo.tsx`.

## Forms & Data

- 📋 Framework-native form handling + Zod validation.
- 📋 API layer must always be typed.
- 📋 Simplest solution, fewest abstraction boundaries.
- 📋 All user-facing strings must be i18n-ready.

## Performance

- ⚠️ Avoid inline arrow functions in JSX event handlers. Extract to `handle*` functions.
- ⚠️ Avoid inline object/array literals in JSX props. Extract to variables.
- 📋 Minimize re-renders with fine-grained Jotai subscriptions.
- 📋 `React.memo` when parent re-renders but child props are stable.
- 📋 Stable references for callbacks and prop objects.
- 📋 Keys: stable unique identifiers, never array indices.
- 📋 Lazy load routes and heavy components.

## AI Behavior

- 📋 MUST read existing codebase before writing code.
- 📋 Research and propose approach. Wait for approval before coding.
- 📋 Never over-engineer. Simplest solution first.
- 📋 Never over-comment. No obvious comments.
- 📋 Never over-abstract. No unnecessary wrappers.
- 📋 Never copy-paste. Extract reusable code.
- 📋 Never write custom code when a library exists.
- 📋 Never use hacks or bandaids. Proper fixes only.
- 📋 Refactor in the same PR, not separate.
- 📋 Use existing utilities and patterns from the project.
- 📋 Semantic HTML. No empty divs.

---

**Legend:** ⛔ = Hook-enforced (blocked), ⚠️ = Hook-warned (reported), 📋 = Instruction-only (your judgment)
