# Pi Replacement Feasibility Spike

Date: 2026-04-29

Method: web/docs review plus local codebase review. No local Pi runtime was installed and no live agent turn was run. This is a feasibility and mechanics study, not a validated implementation.

## Sources Reviewed

- Pi docs:
    - https://pi.dev/docs/latest
    - https://pi.dev/docs/latest/sdk
    - https://pi.dev/docs/latest/rpc
    - https://pi.dev/docs/latest/providers
    - https://pi.dev/docs/latest/models
    - https://pi.dev/docs/latest/custom-provider
    - https://pi.dev/docs/latest/usage
    - https://pi.dev/docs/latest/sessions
    - https://pi.dev/docs/latest/extensions
- Pi package examples:
    - https://pi.dev/packages/pi-subagents
    - https://pi.dev/packages/my-pi
- OpenClaw docs:
    - https://docs.openclaw.ai/pi
    - https://docs.openclaw.ai/concepts/agent
    - https://docs.openclaw.ai/gateway/configuration
    - https://docs.openclaw.ai/automation/cron-jobs
- Local Agent Room code:
    - `src/server/rooms/execution-engine.ts`
    - `src/server/rooms/runtime-engine-profile.ts`
    - `src/server/rooms/openclaw-runtime-engine-profile.ts`
    - `src/server/rooms/openclaw-execution-adapter.ts`
    - `src/server/rooms/openclaw-config.ts`
    - `src/server/configuration/connection-validation.ts`
    - `src/server/configuration/codex-oauth-flow.ts`
    - `Dockerfile`

## Verdict

Pi is suitable as the agent-loop substrate, but not as a complete drop-in replacement for OpenClaw.

The viable direction is not "replace OpenClaw with raw Pi and keep everything else the same". The viable direction is "replace OpenClaw with an Agent Room-owned runtime layer built on Pi". Pi should own model calls, tool execution, session messages, compaction, abort, provider registry, auth resolution, and event streaming. Agent Room should own room identity, runtime process lifecycle, session index/read model, cron scheduling, MCP materialization, entitlement enforcement, run history, connection validation, and the HTTP/SSE control surface.

Outlook if we change now: favorable, but it is a real runtime rewrite. The existing internal execution-engine boundary keeps this from becoming a UI rewrite, but the OpenClaw adapter currently carries important product behavior that must be rebuilt deliberately.

## What Pi Provides

Pi exposes a TypeScript SDK through `@mariozechner/pi-coding-agent`. The central object is `AgentSession`, with `prompt`, `steer`, `followUp`, `subscribe`, model controls, message state, compaction, abort, and cleanup. `AgentSessionRuntime` handles new-session, session switching, forking, clone, and import flows.

Pi supports direct embedding for Node/TypeScript apps. Its RPC docs explicitly say TypeScript integrations should consider using `AgentSession` directly instead of spawning a subprocess. RPC mode is still available over JSONL on stdin/stdout if process isolation matters more than direct API control.

Pi session persistence is already close to what Agent Room needs: sessions are JSONL files, organized under the Pi agent directory by working directory. The SDK exposes `SessionManager`, and the runtime API can open specific session files.

Pi provider support is strong enough for Agent Room's provider surface. The docs list subscription providers including ChatGPT Plus/Pro Codex, Claude Pro/Max, GitHub Copilot, Gemini CLI, and Google Antigravity. API-key providers include Anthropic, OpenAI, Google, Groq, OpenRouter, xAI, Cerebras, and others. Custom providers can be registered through extensions or `models.json`, including `openai-completions`, `openai-responses`, `openai-codex-responses`, Anthropic, Google, Bedrock, Mistral, and Azure OpenAI Responses APIs.

Pi has an intentionally small core. The docs are explicit that Pi does not include built-in MCP, subagents, permission popups, plan mode, to-dos, or background bash. That is a feature for our goal, but it means those pieces must be Agent Room-owned or consciously pulled from Pi packages.

## What OpenClaw Adds Today

OpenClaw is not magic above Pi. Official docs describe it as an embedded runtime built on Pi agent core, with OpenClaw owning session management, discovery, tool wiring, channel delivery, cron, hooks, plugin and channel tools, policy filtering, model/auth failover, and Gateway transport.

The Pi integration docs say OpenClaw imports Pi packages and instantiates `AgentSession`, then wraps it with:

- Gateway request/response and event protocol
- custom tools, channel tools, and policy filtering
- session file placement and cache behavior
- auth profile rotation and failover
- cron and webhook delivery
- OpenClaw-specific prompt construction
- sandbox and provider-specific handling

That supports the intuition behind replacing it. OpenClaw is largely an orchestration layer around Pi plus a broad product surface. Agent Room already owns a narrower room-first product surface, so we can implement a smaller orchestration layer directly.

## Current Agent Room OpenClaw Dependency Points

### Runtime Process

`runtime-engine-profile.ts` has a real abstraction, but it is hardwired to `openClawRuntimeEngineProfile`. The OpenClaw profile resolves `openclaw gateway run`, writes `openclaw.config.json`, writes `openclaw.env`, and sets `OPENCLAW_CONFIG_PATH`, `OPENCLAW_GATEWAY_TOKEN`, `OPENCLAW_STATE_DIR`, `OPENCLAW_WORKSPACE_DIR`, and `OPENCLAW_STORE_DIR`.

The runtime lifecycle already starts one process per room, assigns a loopback port, materializes env/config, pipes logs, waits for loopback health, and persists runtime metadata. That mechanism can be reused for a Pi-based room runtime.

### Execution Adapter

`execution-engine.ts` is the main product boundary. The adapter contract already covers:

- room runtime overview
- room execution snapshot
- send message
- abort message
- edit message capability
- browser SSE stream
- create thread
- cron list/create/update/run/remove
- wake
- runtime truth snapshot
- run history

The loader currently imports `openclaw-execution-adapter` directly. That is the main code switch.

### Gateway Transport

The current adapter depends on OpenClaw's bundled Gateway runtime module at `/usr/lib/node_modules/openclaw/dist/plugin-sdk/gateway-runtime.js`, then sends Gateway methods such as:

- `agents.list`
- `sessions.list`
- `sessions.get`
- `sessions.send`
- `sessions.abort`
- `sessions.create`
- `sessions.messages.subscribe`
- `sessions.subscribe`
- `cron.list`
- `cron.add`
- `cron.update`
- `cron.run`
- `cron.remove`
- `wake`

Replacing OpenClaw means creating equivalent behavior, not just calling Pi. Pi gives session and event APIs, but not this Gateway protocol.

### Config Materialization

`openclaw-config.ts` maps Agent Room's canonical provider, tools, MCP entitlement, model, fallback, Codex transport, workspace, and agent identity into OpenClaw config. The equivalent Pi layer needs canonical Pi materialization:

- room-local Pi agent dir
- room-local auth path
- room-local models path
- room-local settings path
- room-local sessions path
- room-local extension/package path policy
- cwd-bound tools for the room workspace
- explicit env allowlist for provider keys and MCP subprocesses

### Provider Connection Validation

Connection validation currently writes a temporary `openclaw.config.json` and runs:

`openclaw models status --probe-provider ... --json`

That must become a Pi-native probe using `AuthStorage`, `ModelRegistry`, and a minimal one-token model call through the same materialized provider config that rooms use. This is a good change because it removes a second validation path that only approximates runtime behavior.

### Codex OAuth

The current OpenAI Codex OAuth flow drives:

`openclaw models auth login --provider openai-codex --method oauth`

through an `expect` script, extracts the auth URL, and submits the redirect URL back into the process. Pi supports subscription logins including ChatGPT Plus/Pro Codex, stores tokens in `~/.pi/agent/auth.json`, and custom providers can implement OAuth callbacks. We need a Pi-native headless OAuth bridge, not a terminal `expect` wrapper. This is likely the most sensitive migration item because bad OAuth handling can leak tokens or bind a provider to the wrong room.

### Docker Packaging

The Dockerfile currently installs Node.js solely to run global OpenClaw:

`npm install --global "openclaw@${OPENCLAW_VERSION}"`

A Pi replacement can remove global OpenClaw and install Pi as a pinned package dependency or internal workspace package through Bun. If the runtime runs in a separate process, that process should be a TypeScript entrypoint run by Bun rather than a global CLI.

## Replacement Mechanics

### Preferred Architecture

Create a small Agent Room Pi runtime process per room:

- `src/server/rooms/pi-runtime-engine-profile.ts`
- `src/server/rooms/pi-runtime-config.ts`
- `src/server/rooms/pi-execution-adapter.ts`
- `src/server/pi-runtime/main.ts`

Keep one process per room for now. Moving Pi in-process would reduce process count, but it weakens crash isolation, tool isolation, and credential blast-radius boundaries. A per-room Pi runtime still removes the full OpenClaw monolith while preserving the isolation model Agent Room already relies on.

The room runtime process should expose a tiny local HTTP or WebSocket API owned by Agent Room, not Pi RPC directly. Pi RPC is useful as a reference protocol, but Agent Room's product contract should remain the typed `RoomExecutionAdapter` contract.

### Runtime Process API

Minimal runtime-local endpoints or messages:

- `GET /health`
- `GET /snapshot`
- `GET /sessions`
- `GET /sessions/:sessionKey`
- `POST /sessions`
- `POST /sessions/:sessionKey/messages`
- `POST /sessions/:sessionKey/abort`
- `GET /sessions/:sessionKey/events`
- `POST /wake`

Cron should not live inside the Pi runtime at first. Agent Room should persist cron jobs in its DB, run due checks in the server process, acquire a room/job lock, call the same `send` path with a scheduled-run identity, and write run history. This makes scheduling auditable and avoids recreating OpenClaw's scheduler as hidden runtime state.

### State Layout

Replace `openclaw-state` with a versioned Pi state root:

```text
rooms/<roomId>/
    workspace/
    store/
    runtime/
        pi-runtime.config.json
        pi-runtime.env
        logs/pi-runtime.log
        runtime-token
        runtime-metadata.json
        runtime-health.json
        secrets/
    pi-state/
        auth.json
        models.json
        settings.json
        sessions/
        packages/
        extensions/
        skills/
```

Keep Agent Room as the source of truth for room config and entitlements. Materialized Pi files are generated artifacts, not editable canonical state.

### Session Mapping

Map Agent Room thread keys to explicit Pi session files instead of inheriting OpenClaw's `agent:<id>:...` key format.

Proposed canonical record:

- `threadKey`: Agent Room stable ID
- `roomId`
- `sessionFile`
- `sessionId`
- `title`
- `createdAt`
- `updatedAt`
- `status`
- `model`
- `provider`
- `totalTokens`
- `estimatedCostUsd`

Pi can still own the JSONL transcript. Agent Room owns the session index/read model needed for list views and isolation checks. This avoids scanning arbitrary Pi session folders as the only source of truth.

### Streaming

Translate Pi `AgentSession.subscribe` events into Agent Room SSE events:

- text deltas become `room-event` payloads for the selected thread
- tool execution start/update/end becomes existing tool-call parts
- turn start/end updates thread status
- errors become bounded runtime errors
- compaction events become activity entries or low-priority stream events

The important behavioral change is that streaming comes from the Pi SDK event bus, not from OpenClaw Gateway's `chat`, `session.message`, `session.tool`, and `sessions.changed` events.

### Tools And MCP

Use Pi's built-in cwd-bound tool factories for the minimal room toolset. The SDK docs warn that prebuilt tool instances use `process.cwd()`, so a custom `cwd` requires factory-created tools.

For MCP, do not depend on random third-party packages in the first pass. Agent Room already has typed MCP entitlement materialization. Implement a small MCP adapter that:

- reads Agent Room's materialized MCP server grants
- starts stdio MCP servers with bounded env
- connects HTTP/streamable HTTP servers with explicit headers
- registers allowed tools into Pi via `customTools` or an extension
- redacts secrets from tool outputs
- fails closed when initialization or schema mapping fails

Pi packages such as `my-pi` and `pi-subagents` prove MCP and subagents are feasible in Pi's extension model, but they should be source references, not production dependencies, unless we audit and pin them.

### Subagents

Do not make subagents part of the initial OpenClaw removal. Pi core does not include them. `pi-subagents` shows a practical extension with foreground/background runs, chains, parallel execution, worktree isolation, direct MCP tool selection, and agent definitions. That is good evidence of suitability, but Agent Room should add subagents later as first-class room features with explicit job records, concurrency limits, and audit events.

### Cron

Implement Agent Room-owned cron now rather than porting OpenClaw cron:

- DB tables for cron jobs and run history
- scheduler loop in Agent Room server
- per-room and per-job locks
- bounded retry policy
- explicit provider/model snapshot per run
- explicit room entitlement snapshot per run
- send through the same Pi runtime message path as manual room messages
- no silent delivery fallback

This better matches the product's auditability requirement than OpenClaw's runtime-owned `~/.openclaw/cron/jobs.json` model.

### Provider Auth

Use room-local Pi auth and model materialization:

- API-key providers: pass runtime-only keys through `AuthStorage.setRuntimeApiKey` or generated `auth.json` entries that point at room-local secret env names, not literal keys when avoidable
- Codex OAuth: store tokens in room-local `pi-state/auth.json` with strict file permissions
- custom providers: generate `models.json` or an Agent Room extension that registers providers from canonical config
- connection tests: instantiate the same auth/model materialization path used by rooms

OAuth must be fail-closed by room. A token generated for room A must not be readable or selected by room B, and a provider login must record room, user, provider, and profile identity in audit events.

## Suitability Matrix

| Capability                 | Pi fit                                   | Work needed                                                                                 |
| -------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| Manual chat                | Good                                     | Wrap `AgentSession.prompt`, map events and messages                                         |
| Streaming text             | Good                                     | Translate `message_update` events to Agent Room SSE                                         |
| Tool events                | Good                                     | Translate tool execution events and normalize tool result parts                             |
| Abort                      | Good                                     | Use `session.abort()` and map status                                                        |
| Session persistence        | Good                                     | Use Pi JSONL sessions, add Agent Room session index                                         |
| Session list/read model    | Medium                                   | Agent Room should own index and metadata                                                    |
| Provider API keys          | Good                                     | Use Pi `AuthStorage` and runtime keys                                                       |
| Codex OAuth                | Medium                                   | Pi supports Codex subscription login, but headless room-scoped flow must be built carefully |
| Custom providers           | Good                                     | Use `models.json` or extension `registerProvider`                                           |
| MCP                        | Medium                                   | Pi extension model supports it, but core does not ship MCP                                  |
| Cron                       | Poor as core feature                     | Agent Room must implement scheduler and run history                                         |
| Subagents                  | Medium                                   | Feasible via extension model or later first-class Agent Room feature                        |
| Room isolation             | Good if per-room process                 | In-process embedding is not enough for production isolation                                 |
| Runtime truth/auditability | Better than OpenClaw if Agent Room-owned | Requires new DB records and event logs                                                      |
| Drop-in effort             | Not drop-in                              | Adapter plus runtime rewrite                                                                |

## Migration Plan

### Phase 1: Thin Pi Runtime Spike

- Add Pi as a pinned Bun dependency.
- Build one standalone room runtime script that can:
    - load room-local config
    - create a Pi `AgentSession` with cwd-bound tools
    - accept one message over a local API
    - stream text/tool events back
    - persist one session under room-local state
- Do not wire UI yet.

Success criteria:

- one room can send one message and receive final text
- runtime state stays inside the room directory
- provider key is room-local and redacted from logs
- no OpenClaw binary is invoked

### Phase 2: Adapter Parity For Manual Chat

- Implement `pi-execution-adapter.ts` behind `RoomExecutionAdapter`.
- Replace session list, session get, send, abort, create thread, and SSE.
- Keep cron disabled or hidden for Pi rooms until Agent Room-owned cron exists.
- Replace `OpenClawSerializable` in shared execution types with a runtime-neutral JSON type.

Success criteria:

- existing room chat UI works against Pi
- start/stop/runtime health works with the Pi runtime
- selected thread cannot cross room boundaries
- test coverage covers room ownership and stream event filtering

### Phase 3: Provider And OAuth Parity

- Replace OpenClaw provider probe with Pi model/auth probe.
- Replace OpenClaw Codex OAuth `expect` flow with Pi-native room-scoped OAuth.
- Materialize Pi `models.json`, `settings.json`, and auth path from canonical Agent Room config.

Success criteria:

- API-key probe exercises same materialization path as room runtime
- Codex OAuth creates a usable room-scoped auth profile
- provider/model mismatch fails closed

### Phase 4: Agent Room-Owned Cron

- Add DB-backed cron jobs and run history.
- Run due jobs through the same Pi session/message path.
- Show run history through the existing room jobs UI.

Success criteria:

- create/run/restart/disable/delete cron survives stack restart
- cron run history is app-readable without parsing Pi internals
- room/provider/credential snapshots are audited

### Phase 5: MCP And Tool Entitlements

- Implement an Agent Room MCP-to-Pi tool adapter.
- Materialize only allowed MCP servers and allowed tools into the room runtime.
- Add tests for stdio, HTTP, secret redaction, initialization failure, and entitlement denial.

Success criteria:

- MCP connection test uses the same config path as rooms
- denied MCP server or tool cannot be invoked from a room session
- init failure fails closed with a clear room-visible diagnostic

### Phase 6: Remove OpenClaw Packaging

- Remove global OpenClaw install from Dockerfile.
- Remove OpenClaw runtime profile and config once Pi rooms pass full end-to-end validation.
- Keep migration notes for old room state if any rooms were created under OpenClaw.

## Expected Effort

Manual chat parity is achievable in a focused spike. A credible estimate is 2 to 4 engineering days for a thin local runtime plus basic adapter, assuming Pi installs cleanly and provider auth works with runtime API keys.

Full replacement is larger: 2 to 4 weeks for production-ready migration, mostly because cron, OAuth, MCP, run history, test coverage, and state migration must be done carefully. This is still a better investment than deepening the OpenClaw dependency if the product direction is already moving away from OpenClaw.

## Main Risks

### Pi Package Maturity

Pi is moving quickly. Recent public issue/search evidence includes package publishing/version skew problems around `@mariozechner/pi-coding-agent`. Pin exact versions and run install/build smoke tests in CI. Do not depend on `latest`.

### In-Process Temptation

Embedding Pi directly in the Agent Room server would be simpler but weakens isolation. Tool bugs, memory leaks, runaway bash, extension code, or provider auth mistakes would share the app process. The safer first architecture is a small per-room Pi runtime process.

### OAuth Ownership

Codex OAuth is currently OpenClaw-owned through a terminal flow. Replacing it must not introduce shared auth files, global `~/.pi/agent` state, or token copies in logs. This needs specific tests.

### MCP Trust Boundary

Pi extensions can execute arbitrary code. Third-party Pi packages are useful examples, but production MCP should be implemented as an Agent Room-owned adapter with pinned dependencies, typed schemas, and bounded env.

### Session Index Drift

Pi owns JSONL transcript files, but Agent Room needs fast lists, room ownership, status, cost, and audit history. Keep a canonical app-side session index and reconcile from Pi files only as a repair/read-through path.

## Recommendation

Start the replacement now as a spike behind the existing execution-engine boundary. Do not attempt a broad multi-runtime abstraction. Add one Pi runtime profile and one Pi adapter, and make the first milestone manual room chat with provider API-key auth. Keep OpenClaw available until Pi passes direct room behavior, then move cron, OAuth, and MCP one by one.

The architectural bet is sound: Pi gives the smaller agent core we want, and Agent Room is already closer to the correct owner for scheduling, auditability, room isolation, entitlement materialization, provider binding, and UI read models.
