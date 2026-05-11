# Agent Room Architecture

## Scope

Agent Room is a self-hosted web app that supervises persistent room-local agents. Each room is one standalone coworker backed by one room-local runtime cell.

The primary runtime direction is:

- Agent Room owns the product runtime and control plane.
- Pi owns the agent kernel.
- The Pi wrapper is Agent Room-owned code.
- OpenClaw is historical context, not target architecture.

The architecture must make it difficult to create duplicate sources of truth. Provider identity, credentials, room ownership, memory, jobs, artifacts, runtime configuration, and telemetry each need one canonical home.

## Canonical Topology

```text
Browser
    -> Agent Room UI and API
    -> Postgres
    -> Room supervisor
    -> Pi execution adapter
        -> Room runtime cell

Room runtime cell
    -> Pi AgentSession
    -> room workspace
    -> room store
    -> room memory JSON
    -> built-in Agent Room tools
    -> allowed MCP servers
    -> model providers
```

The browser never talks directly to a room runtime. It talks to Agent Room. Agent Room talks to each room runtime over a loopback endpoint with a room-local bearer token.

## Room Cell

One room provisions one runtime cell.

Each room cell has:

- one process boundary
- one room filesystem root
- one workspace
- one durable artifact store
- one Pi state root
- one memory JSON document
- one runtime config
- one runtime token
- one provider binding
- one MCP binding set
- one telemetry stream

Room isolation is an implementation and security property. It is not part of the normal system prompt shown to the model.

## Room Modes

Room mode is the canonical product-level harness selector.

Modes:

- `programmer`: a lean coding harness for source work, shell commands, tests, web lookup, compaction, and future first-party GitHub credential materialization.
- `coworker`: the broad room harness for durable memory, artifacts, office files, images, jobs, MCP, and general autonomous work.

Mode is not a cosmetic preset. It controls the runtime prompt, enabled built-in tool surface, capability derivation, and UI emphasis. Low-level tool lists are derived from the room mode and effective capabilities, not stored as a separate user-facing source of truth.

## Runtime Filesystem

Target layout:

```text
$AGENT_ROOM_DATA_DIR/rooms/<roomId>/
    runtime/
        pi-runtime.config.json
        pi-runtime.env
        runtime.json
        health.json
        token
        logs/
    pi-state/
        auth.json
        models.json
        sessions/
        internal/
            memory.json
            run-ledger/
    workspace/
    store/
        blobs/
        manifests/
        exports/
```

`memory.json` is canonical room memory. It is not split into many hidden memory files.

Run ledgers are execution bookkeeping. They are not memory.

## Execution Contract

Agent Room owns a runtime-neutral room execution contract. The Pi adapter implements it.

The contract covers:

- room runtime health
- thread create/list/read/delete/rename
- send message
- scheduled send
- abort run
- compact thread
- fork thread where supported
- stream events
- list activity
- list run history
- expose runtime truth

Pi-specific payloads are translated at the adapter boundary. Control-plane code should not depend on Pi internals outside the adapter and wrapper.

## Long-Running Work

Long-running work uses an idle watchdog plus total run budget.

Concepts:

- `runBudgetMs`: maximum allowed wall-clock duration
- `idleTimeoutMs`: maximum allowed time without meaningful activity
- `heartbeatAt`: last progress update
- `activeRunId`: current run identity
- `runKind`: manual, scheduled, subagent, maintenance
- `abortReason`: user abort, idle timeout, budget timeout, provider error, tool error, runtime stop

Healthy long work keeps heartbeating through model events, tool starts, tool progress, command output, worker progress, or explicit run ledger updates.

Hung work stops when the idle watchdog fires.

## Shell Execution

Shell execution is a room tool, not a hidden escape hatch.

The target shell model is background-process based:

- start command
- poll output
- inspect status
- terminate command

Short commands can still use a convenience path that starts and waits briefly. Long commands return a handle.

All shell commands must run with:

- room workspace cwd
- bounded environment
- bounded output
- bounded process ownership
- explicit timeout/budget policy
- audit event

## Subagents

Subagents are child Pi sessions inside the same room runtime cell.

Defaults:

- default max active subagents: 5
- hard cap: implementation-defined safety maximum
- no nested subagent spawning in the first pass

Subagents must record:

- parent thread
- parent run
- child thread
- child run
- task
- role/name
- status
- final output
- usage when available

The main agent should delegate bounded tasks and integrate results. Subagents should not become a second product object outside the room.

## Cron And Scheduled Runs

Agent Room owns scheduling. Pi receives scheduled work through the same execution path as manual work.

Cron state lives in Postgres:

- jobs
- due times
- schedule intervals
- enabled state
- running state
- lock token
- lease expiry
- heartbeat
- run history
- provider/model/config snapshot

Locks are renewable leases. A static lock duration is not sufficient.

Scheduled runs are autonomous. They should not wait for human input. If a scheduled task cannot proceed, it records a failed run with a clear reason and any durable partial output.

## Memory Architecture

Memory is one canonical JSON document per room.

The memory service owns:

- schema validation
- migration
- typed patching
- optimistic concurrency
- rendering a two-page prompt brief
- timestamp cleanup
- cap enforcement
- audit metadata

The main agent reads the rendered memory brief. It can call memory tools to update canonical memory when durable facts, behavior rules, deadlines, reminders, decisions, or current work change.

A background memory maintainer periodically cleans the same canonical JSON document. It removes or marks expired timed entries, normalizes timestamps, trims low-value entries, and keeps memory inside the cap.

There is no separate raw memory store.

## Built-In Web Search And Fetch

Web search is an Agent Room capability.

The first backend is an internal SearXNG service in the Docker stack. Agent Room talks to SearXNG through a typed server-side client and exposes a bounded search tool to the agent.

Search tool output includes:

- title
- URL
- snippet
- rank
- source engine where available
- fetchedAt

Direct URL fetch is a separate tool.

Fetch must block:

- localhost
- private IP ranges
- link-local IP ranges
- metadata endpoints
- non-http protocols
- excessive redirects
- oversized responses
- dangerous content types

Browser automation and Chrome MCP are later computer-use capabilities. They should not be required for normal search.

## Office, PDF, And Artifact Workers

Office and PDF support are core capabilities.

Agent Room should provide document workers with typed operations instead of asking the model to mutate proprietary files directly.

Capability modules:

- Documents: DOCX
- Spreadsheets: XLSX
- Presentations: PPTX
- PDF

Each module should support:

- import/inspect
- create
- edit
- export
- render/preview
- store artifact
- return structured errors

The worker may regenerate a file internally when safer than patching the original. The product behavior remains editing the requested file.

Generated and edited artifacts are stored in the room durable store with provenance.

## Image Capability

Images are provider-backed capabilities.

The first provider targets are:

- OpenAI Images
- Gemini/Nano Banana

The image service owns:

- provider config
- encrypted credentials
- model selection
- request validation
- generation
- artifact storage
- provenance
- usage/cost recording

Image tools should be disabled unless the room has an enabled image capability with valid provider configuration.

## Capabilities Model

Capabilities are typed product features, not an unbounded plugin free-for-all.

Initial capabilities:

- web search
- URL fetch
- documents
- spreadsheets
- presentations
- PDF
- images
- MCP
- shell/coding

Capabilities can have app defaults and room overrides. Disabled capabilities must not register tools. Capability state should appear in room status and settings.

## MCP

Current MCP support remains Agent Room-owned.

Supported now:

- stdio MCP
- HTTP/streamable HTTP MCP
- bearer auth
- allowlisted tools
- schema conversion
- redaction

Deferred:

- MCP OAuth
- marketplace/catalogue
- resources
- prompts
- connector-specific UX

These are important, but not first-pass blockers unless a core capability depends on them.

## Provider And Credential Truth

Provider configuration is canonical in Agent Room.

Rules:

- connection tests must exercise the same materialized path used by real rooms
- provider identity must not be hidden behind generic fallbacks
- missing credentials fail closed
- wrong provider/model combinations fail closed
- local provider URLs are explicit
- OAuth is room-scoped where supported
- secrets are materialized only inside the room boundary and redacted everywhere else

No silent provider fallback is allowed for authentication, authorization, provider identity, credentials, runtime config, or execution.

## Telemetry

Telemetry is app-owned product state.

Agent Room should store and aggregate:

- run duration
- active duration
- idle duration
- input tokens
- output tokens
- cached tokens
- reasoning tokens where available
- total tokens
- estimated cost
- provider
- model
- tool calls
- tool durations
- document worker usage
- image usage
- scheduled run usage

Unknown provider usage stays unknown. The app does not fabricate usage.

Usage is visible at:

- session level
- job run level
- room level
- provider/model level
- app level

## System Prompt Builder

Agent Room owns the system prompt builder.

The prompt should address the model as the agent for this workspace. It should include:

- agent identity and purpose
- current date/time and timezone
- room instructions
- rendered memory brief
- current run context
- enabled capabilities
- tool expectations
- work loop
- planning rules
- verification rules
- artifact expectations
- workspace hygiene for non-developer review
- memory update policy
- scheduled-run policy
- communication style

The prompt should not mention:

- other rooms
- room isolation internals
- bearer tokens
- runtime ports
- process ids
- internal topology
- implementation details not needed for execution

## Data Ownership

Postgres owns:

- users
- app sessions
- rooms
- provider connections
- encrypted secrets
- MCP connections
- room config
- jobs
- run history
- telemetry summaries
- audit events
- artifact index metadata

Room disk owns:

- Pi state
- Pi transcripts
- workspace files
- durable artifact bytes
- room memory JSON
- runtime logs
- runtime-local command state

Generated runtime files are materialized state, not user-edited truth.

User-facing workspace files should stay reviewable. Agents may create temporary drafts,
conversion sources, previews, and logs while working, but they should remove throwaway
intermediate files before completing a run unless the operator explicitly asked to keep
them. Internal verification previews belong in temporary hidden runtime paths and
should be removed after verification unless the preview file itself is the requested
deliverable.

## Artifact Store

The room store is content-addressed inside the room.

```text
store/
    blobs/<sha256>
    manifests/<artifactId>.json
    exports/
```

Artifact manifests record:

- artifact id
- kind
- media type
- sha256
- byte length
- source session/job/run
- source tool/capability
- provenance
- createdAt

Cross-room sharing is explicit and copy-based. There are no shared mutable artifact mounts.

## UI Boundary

The UI should show product concepts:

- rooms
- sessions
- jobs
- files
- memory
- capabilities
- usage
- status

The UI should hide implementation internals by default:

- ports
- PIDs
- bearer tokens
- runtime file paths
- raw provider payloads
- raw JSON
- internal process topology

Technical details can appear only inside scoped troubleshooting disclosures.

## Verification Standard

Every architecture track must be verified through:

- unit tests
- integration tests where applicable
- Docker-path smoke tests
- browser-visible behavior checks for UI paths
- downstream-effect checks for duplicated state, stale materialization, and secret leakage

Do not mark implementation plan items complete until direct behavior and downstream effects are verified.
