# Agent Room Context

## Product Thesis

Agent Room is an OSS, self-hosted portal for persistent AI coworkers.

Each room is one standalone coworker with its own identity, memory, workspace, files, jobs, tools, credentials, provider binding, and runtime state. A room can have many sessions, but those sessions are conversations with the same coworker. A scheduled job is work that coworker performs without an active chat.

The user-facing object is the coworker, not the runtime, model loop, shell, or session file.

## Current Direction

The target backend is Pi plus an Agent Room-owned wrapper.

Pi supplies the agent kernel:

- model and provider invocation
- session execution
- message persistence
- streaming events
- compaction
- provider registry hooks
- tool execution hooks

Agent Room supplies the product runtime:

- room lifecycle
- runtime supervision
- provider truth
- credential materialization
- room-local memory
- built-in capabilities
- MCP exposure
- jobs and locks
- audit
- artifacts
- telemetry
- UI read models

OpenClaw is historical context, not the target backend. Agent Room moved away from OpenClaw to avoid inheriting a broad monolith that owns too much orchestration, channel, gateway, cron, plugin, and runtime behavior. The replacement direction is not "raw Pi as the whole app." It is "Agent Room owns the coworker product around Pi."

## What Must Be Required, Not Bloat

The product should not copy OpenClaw's large control plane, but it must still provide the capabilities a real coworker needs.

Required:

- persistent room-local identity and memory
- long-running autonomous work
- scheduled jobs
- web search and direct URL fetch
- normal office and media artifacts
- file previews and durable artifact storage
- provider and model truth
- secret safety
- auditability
- usage and cost telemetry
- MCP support for ecosystem tools
- clean failure and recovery behavior

Bloat:

- a monolithic gateway that owns product state
- broad channel adapters before the room runtime is stable
- hidden plugin systems that bypass Agent Room policy
- duplicated schedulers
- generic provider flattening that hides provider-specific semantics
- UI surfaces for ports, tokens, runtime internals, and raw payloads
- browser automation as the only way to do basic search

## Room Isolation

Each room is isolated by implementation:

- one room root
- one workspace
- one artifact store
- one Pi state root
- one runtime process
- one runtime token
- one provider/materialized config
- one MCP binding set
- one memory source

This matters for code and security, but it should not be explained to the model in the normal system prompt. The model should be addressed as the agent for its own workspace. It does not need to know that other rooms exist.

## Memory Direction

Memory is per room only.

There is no shared personal memory layer. The whole product promise is that the personal assistant room, marketing assistant room, development room, and any other room are separate coworkers with separate context.

The canonical memory source is one JSON document per room. The runtime renders that JSON into a bounded two-page brief and injects it into the prompt. The JSON remains the source of truth. The rendered brief is only a deterministic view.

Memory stores:

- who this agent is
- what this agent is responsible for
- relevant operator preferences for this room
- behavior rules for this room
- current work
- deadlines
- reminders
- durable decisions
- high-importance facts

Current date and time are injected by runtime context and are not stored as memory.

## Web Direction

Web search is a built-in Agent Room capability.

The first implementation should not require another paid search service token. The Docker stack should include an internal search backend, with SearXNG as the target default unless implementation proves it insufficient.

The first web tools are:

- search the web
- fetch a known URL

Browser automation and Chrome MCP are important later, but they belong to a broader computer-use capability. They are not the first search primitive.

## Artifact Direction

Agent Room should speak in normal work formats.

Developers are comfortable with text, Markdown, and JSON. Normal work is done with PDF, DOCX, XLSX, PPTX, images, and eventually video and voice. Internal representations can be structured JSON or Markdown, but final deliverables should match the real-world format implied by the request.

The product must support:

- creating Office files
- editing Office files
- exporting PDFs
- previewing generated artifacts
- generating images through configured providers
- storing artifacts durably with provenance

It is acceptable for an implementation to regenerate a document internally when safer than patching in place, but the product behavior remains "edit this document."

## Telemetry Direction

Usage and cost are product features.

Rooms should show real usage data, not placeholders:

- tokens
- cost estimates
- runtime
- tool calls
- scheduled run history
- document/image worker usage
- provider/model breakdowns

Unknown usage must remain explicitly unknown. Agent Room should not invent cost or token values when the provider does not expose them.

## System Prompt Direction

The system prompt is the harness that ties the product together. It must be specific and operational.

It should tell the model:

- who it is
- what work it owns
- how to plan
- how to execute
- how to verify
- when to search
- how to use memory
- how to produce normal artifacts
- how to handle scheduled autonomous work
- how to communicate results

The base prompt should be shared across room modes, with small mode-specific additions for programmer and coworker behavior. Shared behavior should include a broad work contract: actionable requests are tasks, each non-final turn should use tools or ask only for the one blocker, weak results should trigger another query/path/source, source-dependent work should be grounded in tool evidence, and final answers should start with the result rather than broad context. The user-visible answer is the tie-in summary: useful findings, decisions, artifacts, verification, risks, or named blockers, not exhaustive taxonomies, boilerplate primers, or menus of possible work.

Room instructions and room-local memory are the canonical standing context. Workspace `AGENTS.md`, `CLAUDE.md`, and similar project files should not be injected as room instructions. Programmer rooms may inspect repository guidance files when coding work requires it, but that is task context, not room identity.

It should not explain room isolation, runtime tokens, ports, other rooms, process boundaries, or implementation topology.

## Long-Running Goal Direction

The "agentic coworker" behavior cannot be solved by system prompt tuning alone.

The prompt can bias a single turn toward initiative, tool use, evidence, and concise synthesis. Long-horizon autonomy needs product/runtime primitives: a durable goal record, continuation policy, budget accounting, user controls, clear status, and deterministic feedback.

Codex `/goal` is the right shape to learn from:

- persist a goal on the thread or room with objective, status, token/time usage, optional budget, and timestamps
- expose lifecycle controls to create, inspect, edit, pause, resume, clear, and complete the goal
- continue automatically only when the goal is active, the runtime is idle, no user input is queued, and the current mode allows execution
- inject a hidden continuation prompt that treats the goal objective as untrusted user data
- let the model mark a goal complete only after evidence-backed completion audit
- let user/system code pause, resume, clear, or budget-limit goals; do not let the model use completion as an escape hatch
- account usage against the goal and stop with a concise budget-limited wrap-up when the budget is reached

Ralph loops are useful for the same reason, but they are lower-level. Their main lesson is not "repeat the same prompt forever." It is that the loop needs stable external state and deterministic feedback. Progress should live in files, plans, tests, logs, artifacts, memory, git history, and run records rather than relying on chat context. Each iteration should inspect current state, make one meaningful move, run a real verifier, and either continue, mark complete, or report a concrete blocker.

Agent Room should combine these ideas at the room level:

- room goals are first-class runtime state, separate from long-term memory
- scheduled jobs remain time-based work; goals are objective-based work
- goal continuation should reuse the existing run queue, watchdogs, usage sync, audit trail, and SSE read model rather than polling or spawning uncontrolled loops
- completion should be evidence-based and visible in the transcript, status UI, and usage history
- prompts remain concise because the loop state and feedback are represented by product data, not a giant instruction blob

## Product Principles

- The agent is a coworker, not a chat session.
- A room is standalone.
- Pi is the kernel, not the product owner.
- Agent Room owns orchestration, provider truth, memory, capabilities, artifacts, jobs, audit, telemetry, and UX.
- Normal artifacts are first-class.
- Web access is first-class.
- Memory is typed, bounded, and room-local.
- Fallbacks are explicit, bounded, logged, and fail closed where safety matters.
- The UI should make work understandable without exposing runtime machinery.

## Deployment Readiness Definition

Agent Room is ready for personal deployment when a room can:

- remember room-local durable facts through JSON memory
- search the web
- fetch known URLs safely
- work for hours without false timeout failure
- stop hung work
- run scheduled jobs without duplicate claims
- create and edit normal files
- generate images through configured providers
- show usage and cost telemetry
- remain auditable and room-local

OSS compatibility, public security docs, and release packaging are a separate pass after the core coworker behavior is ready.
