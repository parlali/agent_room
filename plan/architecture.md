# Agent Room Architecture

This document is the canonical architecture direction for Agent Room after the OpenClaw replacement study. It defines the target topology, trust boundary, operating model, and ownership rules for the Pi-based runtime.

## Scope

- Agent Room is a self-hosted operator UI and control application.
- Agent Room manages many persistent room runtimes through one room-scoped execution-engine contract.
- Pi is the target agent kernel. Agent Room owns a custom wrapper around Pi rather than using OpenClaw as the backend.
- OpenClaw is historical implementation context, not the target architecture.
- Codex App Server remains a reference point and possible Codex-specific backend, but it is not the primary room runtime direction.
- One room maps to one dedicated runtime cell and one room brain.
- A room cell is a dedicated process boundary, filesystem root, credential materialization boundary, loopback network boundary, and runtime state boundary.
- Agent Room may index and supervise runtime state, but it must not create competing sources of truth for provider identity, room ownership, credentials, runtime configuration, execution state, or audit state.

## Canonical Topology

The target topology is:

1. Browser clients authenticate to Agent Room.
2. Agent Room stores app-owned state in Postgres.
3. Agent Room provisions and supervises one room runtime cell per room.
4. Each room runtime cell runs an Agent Room-owned Pi wrapper process.
5. The wrapper process embeds Pi or drives Pi through a narrow local runtime interface.
6. Each wrapper listens only on loopback with its own bearer token.
7. Agent Room talks to each wrapper through the execution-engine adapter contract.
8. The wrapper talks to model providers, room-local tools, allowed MCP servers, and the room workspace using only materialized room config.

```text
Browser
    -> Agent Room UI + API
    -> Postgres
    -> Room Manager + Pi Execution Adapter
        -> Room A Pi wrapper on 127.0.0.1:<port-a>
        -> Room B Pi wrapper on 127.0.0.1:<port-b>

Pi wrapper process
    -> Pi AgentSession / provider registry / event stream
    -> room-local workspace
    -> room-local Pi state
    -> room-local materialized secrets and integration config
    -> Agent Room-owned MCP bridge
    -> external model providers and allowed MCP servers
```

There is no shared multi-room runtime endpoint exposed to browsers. Isolation is a product feature, not a later hardening pass.

## Execution Engine Contract

Agent Room defines one canonical contract per room runtime so control-plane behavior stays stable while the underlying runtime implementation changes.

### Contract Responsibilities

- start, stop, restart, and health-check one room runtime instance
- create, list, read, and select room-scoped threads
- execute user messages and scheduled messages within that room context
- stream model, message, tool, error, abort, and completion events
- abort active turns explicitly
- expose room runtime truth and adapter-local diagnostics
- reject unsupported operations explicitly

Sessions are parallel conversations inside the same room brain. They are not separate agents.

### Adapter Rules

- The Pi adapter is the target implementation.
- Pi-specific payloads must be mapped at the adapter boundary.
- Control-plane code must not depend on Pi response shapes outside the adapter.
- Runtime lifecycle, process command composition, and room path materialization must route through the runtime-engine profile boundary.
- There is no user-facing engine selector in the product surface.
- OpenClaw code can remain only as a temporary migration path until Pi reaches parity. New product behavior should target the Pi wrapper contract.

## Responsibility Split

### Agent Room Owns

- built-in operator authentication and app sessions
- room registry, lifecycle, runtime supervision, and health tracking
- encrypted secret storage and entitlement policy
- canonical provider records, model defaults, credential bindings, and validation status
- room-local config, env, secret, model, MCP, and prompt materialization
- the custom Pi wrapper API
- DB-backed cron scheduling, locks, run history, and wake behavior
- app-side thread/session index, titles, status, provider identity, cost summaries, and dashboard read models
- MCP bridge implementation, including stdio and HTTP transports
- audit events for operator actions, entitlement changes, secret rotation, provider binding, runtime lifecycle, scheduled runs, and config drift
- artifact indexing, attachment ingestion, and explicit cross-room share/import workflows
- UI projection of room runtime state without hiding provider-specific or runtime-specific truth

### Pi Owns

- agent session execution
- model/provider invocation once given materialized room config
- message state and persisted transcript files
- streaming session events
- compaction
- model/provider registry hooks
- provider auth storage primitives where suitable
- tool execution hooks and event emission

### Custom Pi Wrapper Owns

- room-local HTTP or WebSocket control surface for Agent Room
- translation between `RoomExecutionAdapter` calls and Pi SDK calls
- Pi session file placement under the room root
- event fan-out from Pi to Agent Room SSE shapes
- room-local system prompt assembly
- room-local tool registration
- room-local provider and auth materialization
- bounded runtime errors and health diagnostics
- lifecycle cleanup for active sessions, tools, MCP clients, and provider handles

### Agent Room Does Not Outsource To Pi

- cron scheduling
- app audit trail
- room ownership checks
- entitlement enforcement
- MCP allowlists and secret policy
- cross-room isolation
- provider connection validation
- user-facing room read models
- deployment and runtime lifecycle

## Conflict Resolution Rules

- Policy truth comes from Agent Room Postgres and the current room materialization.
- Execution truth comes from the room wrapper, Pi session state, and room disk.
- Provider truth comes from the canonical Agent Room provider binding plus the exact materialized runtime config used by the room.
- If Agent Room policy and room runtime state diverge, Agent Room must surface drift and reconcile explicitly.
- Agent Room must not invent silent fallbacks for ports, tokens, providers, secrets, runtime modes, MCP exposure, provider APIs, or auth profiles.

## Room Cell Runtime Spec

One room provisions one isolated Pi wrapper runtime cell.

### Room Root Layout

Each room gets a dedicated root under the Agent Room data directory:

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
        settings.json
        sessions/
        packages/
        extensions/
        skills/
    workspace/
    store/
        blobs/
        manifests/
        exports/
```

The exact Pi files may change as implementation discovers the SDK shape, but all Pi state must remain under the room root or another explicitly room-scoped path. Global `~/.pi` or operator-machine auth state must not be used by room runtimes.

### Required Runtime Materialization

For every room, Agent Room provisions:

- a dedicated runtime config file for the Pi wrapper
- a dedicated Pi state root
- a dedicated workspace at `$AGENT_ROOM_DATA_DIR/rooms/<roomId>/workspace`
- a dedicated durable artifact root at `$AGENT_ROOM_DATA_DIR/rooms/<roomId>/store`
- a unique loopback-only listen port
- a unique bearer token stored in `runtime/token`
- room-local model/provider materialization
- room-local prompt materialization
- room-local MCP exposure derived only from granted entitlements
- room-local secret files and env references

Engine-specific env files are generated from canonical DB state and room-local secrets. They must not be hand-edited.

### Runtime Metadata Contract

`runtime/runtime.json` is Agent Room-owned metadata for supervision only. It records:

- `roomId`
- `port`
- `pid` when running
- `startedAt`
- `configVersion`
- `tokenVersion`
- active runtime kind

It must not mirror messages, provider tokens, workspace contents, transcript bytes, or full tool traces.

### Port Allocation

- Each room gets one unique port bound to `127.0.0.1`.
- Port allocation is dynamic and app-managed.
- Port reuse is allowed only after the previous room process is confirmed stopped.
- If a room cannot get a port, the room stays stopped and surfaces an actionable error.

### Token Allocation

- Each room gets one opaque bearer token generated by Agent Room.
- Tokens are never shown to the browser.
- Token rotation is explicit, versioned, logged, and forces room reconnection.
- Missing or unreadable token material is a hard failure.

### Isolation Policy

Isolation is achieved by the room boundary itself:

- one dedicated wrapper process per room
- one room-local filesystem root per room
- one room-local Pi state root per room
- one loopback-only port per room
- one bearer token per room
- one canonical Dockerized deployment path

Agent Room does not expose room-level sandbox choices, host-runtime modes, or alternate hardening profiles in the product surface.

### Lifecycle

Room lifecycle is:

1. Create the room record.
2. Allocate the room root, port, token, and runtime metadata.
3. Materialize provider config, prompt config, MCP config, env, secret files, and entitlement-derived fragments.
4. Start the Pi wrapper on the room-local port.
5. Initialize Pi with the room-local state root, workspace, provider materialization, prompt, and tool registry.
6. Run the wrapper health check and any required provider/MCP readiness checks.
7. Mark the room healthy only after the health checks succeed.

Any later config, entitlement, provider, prompt, or secret change increments the config version and triggers explicit reconcile behavior. Reconcile may restart the room if the changed surface is not hot-reload-safe.

## Provider And Auth Spec

Agent Room must keep provider configuration typed and canonical.

### Provider Requirements

The first target provider set is:

- local providers, initially Ollama and LM Studio where Pi supports them directly
- OpenRouter
- OpenAI Codex OAuth if legally and technically viable for self-hosted user-owned rooms

Additional providers may be added only when they can be represented without hiding provider-specific semantics or introducing fallback chains.

### Validation Rules

- Connection tests must exercise the same runtime config, credentials, provider path, and materialization path used by rooms and scheduled jobs.
- A provider binding must fail closed when credentials, model ids, auth profiles, or provider APIs do not match the selected runtime path.
- OpenRouter, Gemini, local, Codex OAuth, and other provider paths must report their actual provider/model identity.
- Bad keys, quota errors, unsupported models, unavailable local endpoints, and malformed provider responses must surface bounded diagnostics and must not silently reroute.

### Codex OAuth

Codex OAuth is a migration gate, not an assumed solved feature.

The target is a room-scoped OAuth bridge that:

- never reads or writes global operator auth state
- stores tokens only in the room's authorized state boundary
- records room, user, provider, profile identity, and auth mode in audit events
- fails closed when the OAuth profile cannot be proven room-bound

If Codex OAuth cannot be implemented safely or permitted under service terms, Agent Room must surface that provider path as unsupported rather than falling back to a shared token.

## MCP And Tool Spec

Pi core does not provide the complete MCP surface Agent Room needs. Agent Room owns the MCP bridge.

### MCP Materialization

- MCP servers are selected from an app-managed registry.
- A room grant may restrict the server to a subset of tools or capabilities.
- A room may receive zero MCP servers.
- Materialized MCP config is room-local and may include server ids, allowed tools, transport details, and secret references.
- Unsupported MCP config, failed initialization, or unresolved secret references block room startup when the server is required.

### MCP Runtime Rules

- stdio MCP servers start with bounded env and no ungranted secrets.
- HTTP and streamable HTTP MCP servers receive only explicit configured headers.
- Tool schemas are converted through a typed adapter.
- Allowed tools are registered into Pi only after entitlement checks.
- Denied tools must not appear in the runtime tool list.
- Tool outputs and errors must be redacted before they reach logs or browser payloads.

### File And Shell Tools

The wrapper owns the allowed file and shell surface exposed to Pi.

- Workspace tools operate only inside the room workspace unless explicitly designed as artifact import/export actions.
- Shell tools must have bounded cwd, timeout, output size, and environment.
- File edits must produce inspectable diffs or structured file-change events.
- Patch application, command execution, and destructive file operations require explicit policy decisions before being enabled.
- Tool failures must remain visible as tool failures, not be converted into model text only.

## System Prompt And Context Spec

Agent Room owns the room prompt builder. Pi may execute with the resulting prompt, but it is not the source of product policy.

The prompt builder must include:

- room identity and purpose
- room instructions
- current provider and model path
- workspace policy
- tool and MCP policy
- scheduling context for cron-triggered runs
- credential and secret handling rules
- output and artifact expectations
- applicable local instruction files such as `AGENTS.md`

Context loading must be explicit and bounded:

- no implicit cross-room context
- no implicit global memories
- no silent file ingestion outside the room workspace or selected attachments
- provider context-window limits must be handled before send

## Cron And Wake Spec

Agent Room owns cron and wake behavior.

Cron state lives in Postgres, not in Pi session state. Each scheduled run records:

- room id
- job id
- schedule
- prompt/message
- provider and model snapshot
- entitlement snapshot or version
- run status
- error summary
- linked thread/session id where applicable

Due jobs acquire explicit room and job locks, then call the same adapter send path as manual messages. Retry behavior must be bounded and visible.

## Data Ownership Spec

### Agent Room Postgres Owns

- users
- app sessions
- rooms
- room runtime metadata
- encrypted secrets and secret metadata
- provider connections and room provider bindings
- MCP connection definitions and room MCP bindings
- room cron jobs and run history
- room thread/session index and dashboard read model
- artifact index metadata
- audit events
- UI-local preferences if they later prove necessary

### Room Runtime And Disk Own

- Pi transcript files
- Pi provider/auth state under the room root
- runtime-local event cache if needed for reconnect
- workspace contents
- runtime logs
- adapter-local state needed to resume active sessions

### Ownership Rules

- Agent Room may own a thread/session index, but Pi owns transcript bytes unless explicitly imported into app-owned artifacts.
- Agent Room must not persist a second canonical message history unless a product requirement justifies it and the migration explicitly changes the contract.
- Artifact metadata may live in Postgres, but artifact bytes live on disk under the room root.
- Room deletion must delete the room root only through an explicit destroy path that has already persisted an audit event.

### Reconciliation Rules

- Desired room policy comes from Postgres.
- Effective execution state comes from the Pi wrapper and room filesystem.
- If materialized config does not match desired state, Agent Room rewrites the room-local config and records the config version bump.
- If Pi state cannot be read or reconciled, Agent Room must mark the room degraded rather than fabricate a healthy state.

## File And Artifact Spec

The product needs three distinct file concepts: workspace files, chat attachments, and durable artifacts.

### Workspace

- The workspace is room-owned mutable working state.
- Tool execution may read or write workspace files only through the allowed tool surface.
- Agent Room may browse workspace contents, but it does not redefine workspace files as app-owned records.

### Durable Store

`store/` is the room-owned durable artifact vault. It is separate from the workspace so durable records survive thread churn and do not depend on whatever the agent last edited in the workspace.

Physical storage is:

```text
store/
    blobs/<sha256>
    manifests/<artifactId>.json
    exports/
```

The blob path is content-addressed within the room. There is no cross-room shared blob store.

### Chat Attachments

- Chat attachments are immutable inputs attached to a specific thread or message.
- Their bytes are stored in the room `store/` as blobs plus manifests.
- Their manifest kind is `attachment`.
- They are visible in chat and available for explicit tool use, but they are not silently copied into the workspace.

### Durable Artifacts

- Durable artifacts are room-owned outputs that should remain available outside a single chat turn.
- Their manifest kind is `artifact`.
- They may originate from user upload, workspace export, tool output promotion, or external ingestion.
- Promotion from workspace to durable artifact is an explicit action that records provenance.

### Cross-Room Share And Import

- Cross-room sharing is explicit and copy-based.
- Import creates a new manifest in the destination room with provenance back to the source room and source artifact id.
- Imported bytes are copied into the destination room root.
- There are no shared mutable directories, symlinks, or implicit cross-room mounts.

## Auth Spec

### Built-In Auth Model

- Agent Room ships with built-in local auth backed by Postgres.
- First boot creates an initial root user with a password.
- Passwords are stored as strong one-way hashes.
- Browser sessions are app sessions, not room runtime tokens.
- The browser never receives room bearer tokens or direct room port information.

### Session Model

- Sessions are stored server-side with revocable identifiers.
- Session cookies must be `HttpOnly`.
- Session cookies must be `SameSite=Lax` or stricter.
- Session cookies must be `Secure` whenever the app is not running on plain localhost during local development.

### Reverse-Proxy Assumptions

- Public traffic terminates at Agent Room or at a trusted reverse proxy in front of Agent Room.
- Room runtimes remain loopback-only and are never exposed directly to the LAN or internet.
- WebSocket or SSE forwarding must preserve authenticated session context to Agent Room, not to the room runtime.

### Minimum Self-Hosting Security Posture

- TLS is required for non-localhost deployment.
- Root password setup is mandatory on first boot.
- Secret encryption at rest is mandatory.
- Write routes must enforce origin and CSRF protections.
- Login and privileged mutation routes must be rate-limited.
- Security-sensitive actions must emit audit events.

Unsupported posture for v0:

- anonymous internet exposure
- direct browser access to room runtimes
- shared static room token across multiple rooms

## Realtime And Chat Spec

### Upstream Protocol Handling

- Agent Room talks to rooms using the Pi execution adapter transport.
- Agent Room may normalize events for rendering, but raw runtime events must remain inspectable for debugging.
- The adapter must keep provider-specific and tool-specific event semantics visible when they matter.

### Connection Model

- One upstream connection per active room per Agent Room app instance, unless the wrapper proves a simpler polling model is correct for inactive rooms.
- Fan-out from that upstream connection to all subscribed browser clients for the room.
- No browser-direct room connections.

### Session Scoping

- Every chat thread is scoped by `roomId` plus an Agent Room `threadKey`.
- Pi session ids and session file paths are not treated as globally unique across rooms.
- If an event arrives without enough information to bind it to a room and thread, Agent Room must drop it, log it, and surface a room-level warning if needed.

### Streaming Rendering

- Token deltas render incrementally.
- Final assistant content is committed only when the upstream stream reaches a terminal event.
- Partial tool-call arguments render as provisional state until the upstream event confirms the call shape.
- Interrupted streams remain visibly interrupted rather than being silently stitched into a complete message.

### Tool-Call Rendering

- Tool calls render as explicit typed blocks.
- Tool name, arguments, status, and result boundaries remain visible.
- Raw provider payloads may be expandable for debugging, but the visible default should stay concise.
- Redacted secrets must never be re-expanded from stored UI state.

### Multi-Room Concurrency Assumptions

- Ordering is only meaningful within one room stream.
- The system makes no promise of global event ordering across rooms.
- Multiple browser tabs may subscribe to the same room concurrently.
- If the upstream room connection drops, Agent Room marks the room realtime state degraded, reconnects explicitly, and refreshes from room truth rather than faking missed events.

## Setup UX Spec

The setup surface must stay bounded and managed. The product should expose the smallest set of fields needed to provision a safe room.

### Managed Fields

The default setup flow manages:

- room identity and display name
- room instructions and description
- model or provider selection from entitled credentials
- workspace seed or empty workspace choice
- enabled MCP servers and tools
- typed trigger configuration

### Advanced Escape Hatch

An advanced raw config escape hatch is allowed, but it is bounded:

- it is disabled by default
- it requires explicit operator acknowledgement
- it is stored as a room-scoped override fragment, not as a replacement full config
- it may extend only whitelisted config paths

Reserved paths that the escape hatch must not override include:

- listen port
- bearer token
- room filesystem roots
- state directory
- secret file locations
- provider auth file locations
- MCP entitlement scope

### Validation Rules

- Unknown fields fail validation.
- Unknown entitlement references fail validation.
- Invalid secret references fail validation.
- Unsupported provider or MCP combinations fail validation.
- Conflicting port, path, identity, provider, or auth settings fail validation.
- Validation failure blocks save or room startup.

### Fail-Closed Setup Behavior

- No implicit provider fallback.
- No implicit runtime-path fallback.
- No automatic widening of entitlement scope.
- No automatic room recreation when reconcile fails.
- No hidden mutation of raw config to make an invalid room start.
- No use of global Pi, Codex, OpenClaw, or host-machine auth state.

## Implementation Consequences

- Replace OpenClaw-specific runtime profile, config materialization, provider validation, OAuth flow, adapter, and Docker packaging with Pi wrapper equivalents.
- Keep the existing `RoomExecutionAdapter` boundary, but make it runtime-neutral where OpenClaw names have leaked into types.
- Build the Pi wrapper before broad UI changes so direct behavior and downstream effects can be verified.
- Implement Agent Room-owned MCP, cron, provider validation, session index, and Codex OAuth bridge as first-class product surfaces.
- Remove global OpenClaw packaging only after Pi rooms pass end-to-end manual chat, provider validation, MCP entitlement, cron, audit, and restart persistence tests.
