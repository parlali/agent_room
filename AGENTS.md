Always use bun to run commands.
Always use typescript over javascript.
Always use 4 spaces to indent code.
Never use semicolons when its optional for the language.
Never write inline comments in code.
No Emojis anywhere.

Agent Room is self-hosted agent orchestration software. Correctness, isolation, auditability, credential safety, and runtime/provider truth matter more than convenience.

Never duplicate logic.
Never create multiple sources of truth.
Always clean up redundant code.
Use shared abstractions only when they remove real duplication without hiding runtime-specific or provider-specific semantics.
Do not chain silent fallbacks. Fallbacks must be explicit, logged, bounded, and fail closed for authentication, authorization, room ownership, provider identity, credentials, runtime configuration, and execution.
Keep tool schemas, adapter contracts, persisted state, runtime materialization, provider payload mapping, and MCP configuration typed and canonical.
Treat auth, session ownership, room isolation, secret handling, provider binding, runtime lifecycle, streaming, and job scheduling bugs as safety-critical defects.
When fixing runtime bugs, trace the full path: UI action -> route/server function -> service -> adapter -> OpenClaw runtime -> persisted state -> dashboard/read model.
Tests should cover the real failure mode from logs, exported runtime state, or browser-visible behavior whenever possible.
Connection tests must exercise the same runtime config, credentials, provider path, and materialization path used by rooms and scheduled jobs.
Do not mark plan items complete until direct behavior and downstream effects are verified.
Plan items describe intended behavior to achieve, not specific changes to follow blindly. Implement the smallest correct design that satisfies the behavior and note deviations in `plan/plan.md`.

Do not commit local runtime data, generated credentials, real provider keys, OAuth tokens, personal paths, machine-specific settings, `.env`, `.agent-room`, logs, databases, or Docker volumes.

Planning, context, architecture, and related project Markdown docs live under the `plan/` directory.

When working on `plan/plan.md` tasks:

- ALWAYS check off completed tasks: `- [ ]` becomes `- [x]`
- Add brief notes in parentheses when implementation differs from the original wording
- The plan is the source of truth for progress tracking
- Do not skip or gloss over plan items. Fully implement each intended behavior, then double-check direct and downstream effects for cleanliness, duplication, and bugs.
