# Agent Room Context

## What This Is

Agent Room is an OSS, self-hosted, room-first operator UI. One operator UI manages many persistent room runtimes through a room-scoped execution-engine contract. Each agent is a room: a colleague with its own identity, workspace, memory, tools, triggers, and long-running responsibilities. Chat with it, or let it work unattended through scheduled runs and integrations.

Human analogy: the agent is a colleague at the company, not a session. Threads are separate conversations with that colleague. They remember across threads and keep consistent skills, but each conversation stays scoped to its topic. On top of that, the colleague has work that happens whether or not you are talking to them.

The target backend direction is Pi plus an Agent Room-owned wrapper. Pi supplies the agent kernel. Agent Room supplies the product runtime around it.

## Why This Direction Changed

The original plan used OpenClaw as the first room backend because it already packaged a broad agent runtime with Gateway, sessions, cron, hooks, provider auth, tools, and channel adapters. The replacement study changed the verdict.

OpenClaw is too broad for the product boundary Agent Room needs. It duplicates orchestration responsibilities that should live in Agent Room, brings a large dependency into every room process, and forces runtime/provider truth through OpenClaw's monolithic Gateway semantics.

The current decision is:

- Drop OpenClaw as the target backend.
- Use Pi as the agent kernel.
- Build a custom Agent Room wrapper around Pi.
- Keep the room execution-engine boundary internal and stable.
- Keep Codex App Server as a reference or possible Codex-specific backend, not the main runtime.

## Why The Gap Exists Now

Three things had to land simultaneously:

1. Provider breadth across local models, OpenRouter, OpenAI, Gemini, Anthropic, and custom endpoints is now practical enough to support a model-agnostic room product.
2. Pi provides a small enough coding-agent kernel to build around without inheriting OpenClaw's product surface.
3. Cheap per-room process isolation is practical in a self-hosted stack.

The missing product is the operator surface and orchestration layer: rooms, scheduling, audit, provider truth, credential boundaries, MCP entitlement, durable artifacts, and multi-room UX.

## Why Not Just Use X

- **Anthropic Managed Agents / Microsoft Agent 365 / Salesforce Agent Fabric** - closed, vendor-locked, single-model or enterprise-only.
- **LibreChat / LobeChat** - chat-with-tools. No room-first runtime, filesystem, schedule, or colleague model.
- **Agent Zero** - framework-shaped with a primary agent spawning subordinates. Useful ideas, wrong default object model.
- **Hermes Agent** - single persistent agent. Useful gateway and continuity ideas, not many room-first colleagues.
- **Mission Control (builderz-labs)** - strong deploy and observability ideas, but task-board and adapter-layer shaped.
- **CrewAI / AutoGen / LangGraph** - frameworks, not self-hosted operator UIs.
- **OpenClaw Control UI** - proves some runtime pieces exist, but keeps the product centered on OpenClaw's monolith rather than Agent Room's room contract.
- **Codex App Server** - open-source and substantial, but it is a Codex-shaped harness. It is a useful reference and possible backend for Codex-specific flows, but Pi is a better strategic base if provider neutrality matters.

## What Pi Provides

Pi is the agent-kernel dependency, not the product runtime.

Pi should own:

- session execution
- provider/model registry hooks
- provider invocation
- message state
- transcript persistence
- streaming agent events
- compaction
- auth storage primitives where suitable
- tool execution hooks
- extension points for providers, prompts, and tools

Pi does not remove the need for Agent Room's own runtime layer.

## What Agent Room Builds

- TanStack Start + TypeScript + Tailwind + shadcn/ui. Bun for install and scripts.
- Control plane that supervises one isolated Pi wrapper endpoint per room.
- A custom per-room Pi wrapper process with a small local API for health, snapshot, thread list/read/create, send, abort, and event streaming.
- Room directory across many room brains, with status and health visible before entering a room.
- Per-room workspace: room brain summary, activity feed, session list, chat, cron, trigger config, memory/workspace visibility, artifacts, and run history.
- Canonical provider configuration and validation for local providers, OpenRouter, Codex OAuth where viable, and future explicit providers.
- Agent Room-owned MCP bridge with stdio and HTTP transports, tool allowlists, schema conversion, and secret redaction.
- Agent Room-owned cron and wake scheduling with locks, run history, audit events, and provider/model snapshots.
- Agent Room-owned prompt builder for room identity, policy, tools, scheduling context, and local instruction files.
- Optional integration adapters only when daily use demands them, such as signed webhook verification or non-Gmail email subscribers.

## What Agent Room Does Not Build

- A raw model loop from scratch while Pi can supply the kernel.
- A broad plugin framework before the Pi wrapper proves the room runtime.
- User-facing sandbox or engine choice.
- Silent provider fallback or generic model-provider flattening.
- Duplicate transcript persistence unless a later product requirement explicitly changes the source-of-truth contract.
- Channel adapters and broad integration surfaces before the core room runtime is stable.

## Architecture

Agent Room ships as a separate service that supervises room runtimes. Each room runs one dedicated Pi wrapper process behind the internal adapter boundary.

Agent Room owns lifecycle, routing, locks, provider records, secret materialization, MCP entitlement, cron, audit, UI read models, and reconciliation. Pi owns the agent session kernel inside the wrapper. The wrapper translates between Agent Room's room contract and Pi's SDK/event surfaces.

## Isolation Model

Isolation comes from:

- one dedicated wrapper process per room
- one room-local filesystem root per room
- one room-local Pi state root per room
- one bearer token per room
- one loopback-only port per room
- one canonical Dockerized deployment path

Room runtimes must not use global `~/.pi`, `~/.codex`, `~/.openclaw`, host-machine provider tokens, or shared runtime state.

## Principles

- The agent is a colleague, not a session.
- Pi is the kernel, not the product owner.
- Agent Room owns orchestration, policy, provider truth, scheduling, audit, and UX.
- The room runtime owns only the execution state it directly produces.
- Provider semantics stay visible. No generic abstraction may hide provider identity or auth behavior.
- One strict execution-engine contract now. Add abstraction only when it removes real duplication.
- Correctness, isolation, auditability, credential safety, and runtime/provider truth beat convenience.

## OpenClaw Findings Kept As Historical Context

OpenClaw was useful because it proved many runtime surfaces are real:

- Gateway transport can back an external UI.
- Sessions and event streams are enough to render a room workspace.
- Cron and wake behavior are valuable product features.
- Per-runtime filesystem and credential boundaries are the right isolation shape.
- The bundled Control UI does not solve the room-first operator UX.

The replacement study concluded that Agent Room should implement the orchestration pieces directly around Pi instead of inheriting OpenClaw's monolith.

## Locked Product Decisions

1. **Default room view:** hybrid, biased toward recent unattended activity with chat always visible.
2. **Trigger UX:** typed per-trigger forms first. Add raw JSON only as a bounded advanced escape hatch later.
3. **UI-local persistence:** no separate UI database for v0 unless a clearly non-derivable concern proves itself.
4. **Runtime isolation model:** exactly one dedicated Pi wrapper runtime per room. No shared multi-room runtime and no user-facing engine selector.
5. **Deployment story:** one canonical self-hosting path. Full runtime behavior must work inside the stack with no host OpenClaw dependency.
6. **Runtime strategy:** implement Pi first behind the existing adapter boundary. Remove OpenClaw only after Pi passes direct room behavior and downstream verification.
