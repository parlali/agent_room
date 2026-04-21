# Agent Room Architecture

This document is the Phase 1 contract for Agent Room. It defines the canonical topology, trust boundary, operating model, and ownership rules for the first implementation.

## Scope

- Agent Room is a self-hosted operator UI and control application
- Agent Room owns a room-scoped execution-engine contract boundary around execution, memory, sessions, tools, hooks, and scheduling
- OpenClaw is the only shipped execution-engine implementation today; the engine boundary is internal and not user-configurable
- One room maps to one dedicated execution cell and one room brain
- A room cell is a dedicated runtime instance, filesystem root, credential materialization boundary, and loopback-only network boundary
- Agent Room may index and supervise runtime state, but it must not create a second source of truth for execution or accounting state

## Canonical Topology

The locked topology for v0 is:

1. Browser clients authenticate to Agent Room
2. Agent Room stores app-owned state in Postgres
3. Agent Room provisions and supervises one room runtime instance per room through the execution-engine adapter
4. Each room process listens on its own loopback-only port with its own bearer token
5. Agent Room talks to each room over the execution-engine contract and adapter transport
6. The room runtime talks directly to providers, channels, hooks, local tools, and allowed MCP servers using only the room-local materialized config

```text
Browser
    -> Agent Room UI + API
    -> Postgres
    -> Room Manager + Execution Engine Adapter
        -> Room A runtime on 127.0.0.1:<port-a>
        -> Room B runtime on 127.0.0.1:<port-b>

Room process
    -> room-local workspace
    -> room-local runtime state
    -> room-local materialized secrets and integration config
    -> external providers and allowed MCP servers
```

There is no shared multi-room runtime endpoint exposed to the browser. Isolation is a product feature, not a later hardening pass.

## Execution Engine Contract

Agent Room defines one canonical contract per room runtime so control-plane behavior stays stable across runtime implementations.

### Contract responsibilities

- start, stop, restart, and health-check one room runtime instance
- execute chat and tool requests within that room context
- expose room-scoped sessions, streaming events, and trigger operations
- treat sessions as parallel chats inside the same room brain, not as separate agents
- return raw runtime payloads for audit and debugging
- reject unsupported operations explicitly

### Adapter rules

- OpenClaw adapter is the current implementation
- OpenClaw-specific payloads must be mapped at the adapter boundary
- Control-plane code must not depend on OpenClaw-only response shapes outside the adapter
- Any future engine implementation must satisfy the same room-scoped contract
- Runtime lifecycle, process command composition, and room path materialization must route through an engine profile boundary so adding a new engine does not require control-plane rewrites
- There is no user-facing engine selector while OpenClaw is the only shipped engine

## Trust Boundary And Responsibility Split

### Agent Room owns

- Built-in operator authentication and app sessions
- Room registry, lifecycle, runtime supervision, and health tracking
- Encrypted secret storage and entitlement policy
- Materialization of room-local OpenClaw config, env, and secret files
- Artifact indexing, attachment ingestion, and explicit cross-room share/import workflows
- Audit events for operator actions, entitlement changes, secret rotation, room creation, room deletion, and config drift
- UI projection of room runtime state without redefining engine semantics

### Room execution engine owns (OpenClaw today)

- Agent execution
- Sessions, messages, streamed events, and run lifecycle
- Memory files and agent identity files
- Workspace contents and tool-side file operations
- Cron jobs, inbound hooks, and channel-trigger execution
- Provider/tool invocation behavior and provider-native payload semantics

For non-OpenClaw runtimes, the same ownership categories apply to the room execution engine implementation.

### Conflict resolution rules

- Execution truth comes from the room runtime and on-disk state
- Policy truth comes from Agent Room Postgres and the current room materialization
- If Agent Room policy and room runtime state diverge, Agent Room must surface drift and reconcile explicitly
- Agent Room must not invent silent fallbacks for ports, tokens, providers, secrets, runtime modes, or MCP exposure

## Room Cell Runtime Spec

One room provisions one isolated runtime cell.

### Room root layout

Each room gets a dedicated root under the Agent Room data directory:

```text
$AGENT_ROOM_DATA_DIR/rooms/<roomId>/
    runtime/
        openclaw.config.json
        openclaw.env
        runtime.json
        health.json
        token
        logs/
    openclaw-state/
    workspace/
    store/
        blobs/
        manifests/
        exports/
```

### Required runtime materialization

For every room, Agent Room provisions:

- runtime config path and state path for the active engine implementation (OpenClaw profile uses `OPENCLAW_CONFIG_PATH` and `OPENCLAW_STATE_DIR`)
- a dedicated workspace at `$AGENT_ROOM_DATA_DIR/rooms/<roomId>/workspace`
- a dedicated durable artifact root at `$AGENT_ROOM_DATA_DIR/rooms/<roomId>/store`
- a unique loopback-only listen port
- a unique bearer token stored in `runtime/token`
- room-local plugin and MCP exposure config derived only from granted entitlements

`runtime/openclaw.env` is the OpenClaw profile env file Agent Room writes for a room process. Engine-specific env files are generated from canonical DB state and room-local secrets and must not be hand-edited.

### Runtime metadata contract

`runtime/runtime.json` is Agent Room-owned metadata for supervision only. It records:

- `roomId`
- `port`
- `pid` when running
- `startedAt`
- `configVersion`
- `tokenVersion`

It must not mirror chat, sessions, cron state, or workspace state.

### Port allocation

- Each room gets one unique port bound to `127.0.0.1`
- Port allocation is dynamic and app-managed
- Port reuse is allowed only after the previous room process is confirmed stopped
- If a room cannot get a port, the room stays stopped and surfaces an actionable error

### Token allocation

- Each room gets one opaque bearer token generated by Agent Room
- Tokens are never shown to the browser
- Token rotation is explicit, versioned, logged, and forces room reconnection
- Missing or unreadable token material is a hard failure

### Isolation policy

Isolation is achieved by the room boundary itself:

- one dedicated runtime instance per room
- one room-local filesystem root per room
- one loopback-only port per room
- one bearer token per room
- one canonical Dockerized deployment path

Agent Room does not expose room-level sandbox choices, host-runtime modes, or alternate hardening profiles in the product surface.

### Plugin and MCP materialization

- Agent Room does not host MCP servers
- Agent Room only exposes MCP servers that have been explicitly entitled to the room
- Materialized MCP config is room-local and may include server ids, allowed tools, transport details, and secret references
- Unsupported MCP config or unresolved secret references block room startup

### Lifecycle

Room lifecycle is:

1. Create room record
2. Allocate room root, port, token, and runtime metadata
3. Materialize config, env, secret files, and entitlement-derived fragments
4. Start the configured room runtime on the room-local port
5. Run health check
6. Mark room healthy only after the health check succeeds

Any later config, entitlement, or secret change increments the config version and triggers explicit reconcile behavior. Reconcile may restart the room if the changed surface is not hot-reload-safe.

## Data Ownership Spec

### Agent Room Postgres owns

- users
- app sessions
- rooms
- room runtime metadata
- encrypted secrets and secret metadata
- room entitlement bindings
- artifact index metadata
- audit events
- UI-local preferences if they later prove necessary

### Room runtime and disk own

- sessions and their identifiers
- message history and stream state
- run history and tool execution traces
- cron definitions and runtime cron state
- memory files such as `AGENTS.md`, `MEMORY.md`, and `SOUL.md` when supported by the active engine
- workspace contents
- provider-native runtime state and adapter-local state

### Ownership rules

- Agent Room must not persist a shadow `messages`, `runs`, `cron_jobs`, `workspace_files`, or `memory_documents` schema
- If the UI needs fast access, Agent Room may cache derived projections in memory, but it must be clear they are non-canonical and disposable
- Artifact metadata may live in Postgres, but artifact bytes live on disk under the room root
- Room deletion must delete the room root only through an explicit destroy path that has already persisted an audit event

### Reconciliation rules

- Desired room policy comes from Postgres
- Effective execution state comes from the room process and its filesystem
- If materialized config does not match current desired state, Agent Room rewrites the room-local config and records the config version bump
- If OpenClaw state cannot be read or reconciled, Agent Room must mark the room degraded rather than fabricate a healthy state

## Integrations And Entitlements Spec

An entitlement is an explicit grant that allows one room to access one integration surface with one bounded scope.

### Entitlement categories

- provider credentials for model or API access
- account integrations such as mail, calendar, and GitHub
- MCP server exposure
- webhook or channel credentials that OpenClaw uses directly

### Entitlement model

Each entitlement binding must identify:

- `roomId`
- `kind`
- `provider`
- `accountId` or `serverId`
- `scope`
- `secretRef`
- `status`
- `version`

There are no wildcard grants like "all credentials" or "all MCP servers".

### Materialization rules

- Secrets are stored encrypted in Postgres
- Secret plaintext is materialized only into the target room root
- Materialized secret files and env fragments must have room-local permissions only
- The room process receives only the exact credentials and config fragments needed for its granted entitlements
- Revoking an entitlement removes its materialized config on reconcile and restarts the room if required

### Provider-specific behavior

- Mail, calendar, GitHub, and other provider integrations keep provider-specific semantics
- Agent Room may map a grant into OpenClaw config, env, or MCP wiring, but it must not hide provider identity behind a generic adapter abstraction
- If a provider path is unsupported by the current OpenClaw cell design, Agent Room must reject the grant instead of proxying it through an implicit fallback

### MCP exposure

- MCP servers are selected from an app-managed registry
- A room grant may restrict the server to a subset of tools or capabilities
- A room may receive zero MCP servers
- MCP changes are room-scoped and never global

## File And Artifact Spec

The product needs three distinct file concepts: workspace files, chat attachments, and durable artifacts.

### Workspace

- The workspace is OpenClaw-owned mutable working state
- Tool execution may read or write workspace files
- Agent Room may browse workspace contents, but it does not redefine them as app-owned records

### Durable store

`store/` is the room-owned durable artifact vault. It is separate from the workspace so that durable records survive thread churn and do not depend on whatever the agent last edited in the workspace.

Physical storage is:

```text
store/
    blobs/<sha256>
    manifests/<artifactId>.json
    exports/
```

The blob path is content-addressed within the room. There is no cross-room shared blob store.

### Chat attachments

- Chat attachments are immutable inputs attached to a specific thread or message
- Their bytes are stored in the room `store/` as blobs plus manifests
- Their manifest kind is `attachment`
- They are visible in chat and available for explicit tool use, but they are not silently copied into the workspace

### Durable artifacts

- Durable artifacts are room-owned outputs that should remain available outside a single chat turn
- Their manifest kind is `artifact`
- They may originate from user upload, workspace export, tool output promotion, or external ingestion
- Promotion from workspace to durable artifact is an explicit action that records provenance

### Cross-room share and import

- Cross-room sharing is explicit and copy-based
- Import creates a new manifest in the destination room with provenance back to the source room and source artifact id
- Imported bytes are copied into the destination room root
- There are no shared mutable directories, symlinks, or implicit cross-room mounts

### Manifest minimum fields

Every artifact manifest must include:

- `artifactId`
- `kind`
- `sha256`
- `byteLength`
- `mediaType`
- `createdAt`
- `createdBy`
- `source`
- `provenance`

## Auth Spec

### Built-in auth model

- Agent Room ships with built-in local auth backed by Postgres
- First boot creates an initial root user with a password
- Passwords are stored as strong one-way hashes
- Browser sessions are app sessions, not OpenClaw tokens
- The browser never receives room bearer tokens or direct room port information

### Session model

- Sessions are stored server-side with revocable identifiers
- Session cookies must be `HttpOnly`
- Session cookies must be `SameSite=Lax` or stricter
- Session cookies must be `Secure` whenever the app is not running on plain localhost during local development

### Reverse-proxy assumptions

- Public traffic terminates at Agent Room or at a trusted reverse proxy in front of Agent Room
- Room runtimes remain loopback-only and are never exposed directly to the LAN or internet
- WebSocket forwarding must preserve authenticated session context to Agent Room, not to the room runtime

### Minimum self-hosting security posture

- TLS is required for non-localhost deployment
- Root password setup is mandatory on first boot
- Secret encryption at rest is mandatory
- Write routes must enforce origin and CSRF protections
- Login and privileged mutation routes must be rate-limited
- Security-sensitive actions must emit audit events

Unsupported posture for v0:

- anonymous internet exposure
- direct browser access to room runtimes
- shared static room token across multiple rooms

## Realtime And Chat Spec

### Upstream protocol handling

- Agent Room talks to rooms using the execution-engine adapter transport (native OpenClaw HTTP and WebSocket for the current adapter)
- Agent Room does not redefine the upstream event model into a second canonical schema
- The app may normalize events for rendering, but the raw upstream event must remain inspectable for debugging

### Connection model

- One upstream WebSocket connection per active room per Agent Room app instance
- Fan-out from that upstream connection to all subscribed browser clients for the room
- No browser-direct room connections

### Session scoping

- Every chat thread is scoped by `roomId` plus the OpenClaw `sessionKey`
- `sessionKey` is not treated as globally unique across rooms
- If an event arrives without enough information to bind it to a room, Agent Room must drop it, log it, and surface a room-level warning if needed

### Streaming rendering

- Token deltas render incrementally
- Final assistant content is committed only when the upstream stream reaches a terminal event
- Partial tool-call arguments render as provisional state until the upstream event confirms the call shape
- Interrupted streams remain visibly interrupted rather than being silently stitched into a complete message

### Tool-call rendering

- Tool calls render as explicit typed blocks
- Tool name, arguments, status, and result boundaries remain visible
- Raw provider payloads may be expandable for debugging, but the visible default should stay concise
- Redacted secrets must never be re-expanded from stored UI state

### Multi-room concurrency assumptions

- Ordering is only meaningful within one room stream
- The system makes no promise of global event ordering across rooms
- Multiple browser tabs may subscribe to the same room concurrently
- If the upstream room connection drops, Agent Room marks the room realtime state degraded, reconnects explicitly, and refreshes from room truth rather than faking missed events

## Setup UX Spec

The setup surface must stay bounded and managed. The product should expose the smallest set of fields needed to provision a safe room.

### Managed fields

The default setup flow manages:

- room identity and display name
- base agent instruction files and room description
- model or provider selection from entitled credentials
- workspace seed or empty workspace choice
- enabled integrations and MCP servers
- typed trigger configuration

### Advanced escape hatch

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

### Validation rules

- Unknown fields fail validation
- Unknown entitlement references fail validation
- Invalid secret references fail validation
- Unsupported provider or MCP combinations fail validation
- Conflicting port, path, or identity settings fail validation
- Validation failure blocks save or room startup

### Fail-closed setup behavior

- No implicit provider fallback
- No implicit runtime-path fallback
- No automatic widening of entitlement scope
- No automatic room recreation when reconcile fails
- No hidden mutation of raw config to make an invalid room start

## Implementation Consequences For Phase 2

- Bootstrap TanStack Start on Bun and TypeScript against this per-room process model
- Build Postgres tables only for app-owned data described above
- Start with one root user auth flow and explicit audit events
- Build the runtime manager as a room supervisor plus runtime adapter boundary, not a multi-tenant shared Gateway wrapper
- Build config materialization before broad UI surface area so validation and reconcile stay canonical
