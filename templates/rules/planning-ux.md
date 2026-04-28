---
name: planning-ux
description: How the agent surfaces options after the user states intent. Voice-first, never unilateral, feature-domain-focused.
---

# Planning UX

When the user states intent for non-trivial work AND no `in_progress` claim exists, the agent presents a **menu of options** and waits for the user to pick. The agent never unilaterally files an epic.

## What goes on the menu

**Top half — feature-domain options (2–4 of these).**

The options are about the **actual problem** the user wants to solve, not about ticket structure. For "let's add OAuth," the options should be about OAuth: which providers, which integration shape, whether to migrate users — not "single ticket vs multi-ticket epic." Structure follows scope; the user picks scope.

The agent generates these options based on its understanding of the request plus what the codebase shows. If the request is genuinely ambiguous, the agent uses fewer options + offers `Grill me`.

**Bottom half — process overrides (always present).**

| Option | Action |
|---|---|
| **Grill me** | Invoke the `grill-me` skill — interview one-question-at-a-time with recommended answers, walk the design tree, then re-surface a fresh menu. |
| **Chat about it** | Informal discussion, no commitment to a structure yet. |
| **Just do it** | Skip planning ceremony for trivial single-file work. The agent files a single bd task and proceeds. |
| **Defer** | File a `--type=task --defer` bd issue so the request stays out of `bd ready` until re-prioritized. No work happens now. |

## How to render the menu

- **Markdown list by default.** A short prose description per option, voice-friendly, no chip-UI constraints.
- **`AskUserQuestion` tool** when the choice is small (2–4 mutually-exclusive options) AND benefits from a chip UI (phone tapping, click-driven sessions). The tool caps each question at 4 options + auto-injected "Other"; the agent picks per context.

## Hard rules

- **Never file an epic without explicit user approval.** The agent drafts the EARS body + child tickets in conversation, shows the draft, accepts redirects, and only runs `bd create --type=epic` after the user signs off.
- **Never invoke grill-me unilaterally.** It's always a menu choice. If the agent thinks grilling would help, it surfaces `Grill me` as an option and lets the user pick.
- **Never restructure user intent.** If the user says "let's add Google OAuth," the menu options are about Google OAuth (callback URL, session storage, token refresh). They are NOT about whether to also do GitHub or Apple, unless the user opens that door.
- **Don't ask "want me to..." follow-ups.** Surface a menu or take a clear next action. Never end with a follow-up question.

## When the menu does NOT apply

- The user already has an `in_progress` claim and is continuing that work.
- The user explicitly stated a single concrete change ("rename `foo` to `bar`", "fix the typo on line 42").
- The change is trivially scoped (one file, one concern, no design decisions).
- The user typed a slash command — they've made the choice already.

In those cases, the agent works directly, no menu.

## After the menu choice

- **Feature option chosen** → draft the epic body + children in conversation; show; accept redirects; user approves; `bd create`.
- **`Grill me` chosen** → invoke the grill-me skill; resolve the design tree; re-surface a fresh menu (now with grilled-shape options).
- **`Chat about it`** → discuss; no bd writes until the user moves to a structural option.
- **`Just do it`** → file a single `bd create --type=task` with the user's intent as the title; claim it; work it.
- **`Defer`** → `bd create --type=task --defer +<period>` with the request as title; report the new ID; no further action.
