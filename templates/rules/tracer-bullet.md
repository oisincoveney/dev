---
name: tracer-bullet
description: What counts as a tracer-bullet child. Rubric for picking thinnest end-to-end slice that proves the path before fan-out.
---

# Tracer Bullet

Tracer = thin end-to-end slice through ALL integration layers. Lands first, proves path, unlocks fan-out. NOT smallest mergeable atomic unit. NOT user-visible-feature unit.

## Rules

Exactly **one** child per epic graph: `tracer: true`. Gate enforces.

Tracer must:
- **Cut every layer.** Schema, business logic, surface, tests. End-to-end.
- **Demoable alone.** After tracer lands, system runs + serves real data on this path.
- **Smallest such slice.** Pick narrowest end-to-end cut. Wider tracer = more risk before fan-out.
- **Unblock siblings.** Sibling children typically depend on tracer (`blocked_by: [<tracer-id>]`). Tracer = critical path.

## Anti-patterns (NOT tracer)

- ❌ "Set up the project" — no business logic, no surface.
- ❌ "Add types/interfaces" — single layer.
- ❌ "Write the docs first" — no code path proven.
- ❌ "Migrate the schema" — no calling code, no demo.
- ❌ "Wire CI" — meta, doesn't prove the feature.

## Examples

### Auth0 SSO (good tracer)

`a (tracer): Auth0 SDK + /login redirect e2e`

Cuts: dependency install + config wiring + route handler + redirect URL + smoke test of redirect flow. Demoable: `/login` redirects to Auth0 universal login on staging. Siblings (callback, session, signup) depend on it.

### Multi-parser scraper (good tracer, jalgpall-e82.13)

`PROOF: end-to-end mise refresh + site renders real data`

Cuts: scraper + parser + DB write + astro build + page render. Demoable: real player data on real page. Siblings parse other entities, depend on tracer's pipeline.

### Backend-only epic (good tracer)

`a (tracer): POST /payments returns 201 with idempotency key + DB row`

Cuts: route + handler + validation + DB write + idempotency check + integration test. Demoable: curl returns 201 + row exists. Siblings (rate limit, error handling, observability) depend on it.

### What NOT to tracer (epic-level antipatterns)

`tova-qys` ("MVP-OBSERVABILITY: Sentry+Redis+CSP+monorepo+contract"). 11 children, no tracer marked. Even if one were marked, no thin slice proves *all* domains end-to-end — they're unrelated. Symptom: bundled multi-domain epic. Fix: split into 4 epics, one per domain, each with own tracer.

`rondo-64a` ("user identity + storage track"). 5 backend subsystems. No tracer because no slice cuts all 5 — they're independent. Fix: 5 separate epics OR one epic on the most coupled 2.

## Selecting the tracer

Ask: "After this child closes, can I demo the epic's `artifact`?" Yes → tracer candidate. No → not tracer.

If no slice answers yes, the epic is bundled — split before fan-out.

## See also

- `tracker-workflow.md` — graph/tracer approval and execution rules
- Backlog.md task dependencies and notes — canonical tracker location for tracer metadata
