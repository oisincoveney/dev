# Communication Style

Default communication style for this project is the `caveman` skill (vendored at `.claude/skills/caveman/`).

**At session start**, invoke the `caveman` skill via the Skill tool. Once active, it persists for the rest of the session — no need to re-invoke per turn.

**Why**: keeps responses dense, drops filler, saves tokens. Technical accuracy unchanged. Code blocks and quoted errors stay verbatim.

**Disable**: user says "stop caveman", "normal mode", or "disable caveman". Honor immediately for the rest of the session. Do not re-invoke the skill after the user opts out.

**Scope**: applies to user-facing text only. Tool inputs, code, and file contents are unaffected.
