# Runtime Replacement Direction Study

Date: 2026-04-29

Scope: decide whether the OpenClaw replacement should be based on Pi, Codex App Server, or another runtime substrate. The hard provider gates are local models, Codex OAuth, and OpenRouter. This is a feasibility study, not a validated migration. No live provider calls were run.

## Sources Reviewed

- OpenAI Codex App Server docs: https://developers.openai.com/codex/app-server
- OpenAI Codex config reference: https://developers.openai.com/codex/config-reference
- OpenAI Codex auth docs: https://developers.openai.com/codex/auth
- OpenAI Codex SDK docs: https://developers.openai.com/codex/sdk
- OpenAI Codex MCP docs: https://developers.openai.com/codex/mcp
- OpenAI Codex subagents docs: https://developers.openai.com/codex/subagents
- OpenAI Codex app automations docs: https://developers.openai.com/codex/app/automations
- OpenAI App Server design article: https://openai.com/index/unlocking-the-codex-harness/
- Pi docs: https://pi.dev/docs/latest
- Pi providers docs: https://pi.dev/docs/latest/providers
- Pi RPC docs: https://pi.dev/docs/latest/rpc
- Pi SDK docs: https://pi.dev/docs/latest/sdk
- Pi custom provider docs: https://pi.dev/docs/latest/custom-provider
- OpenRouter Codex CLI guide: https://openrouter.ai/docs/guides/coding-agents/codex-cli
- OpenRouter quickstart: https://openrouter.ai/docs/quickstart
- Local Agent Room code:
    - `src/server/rooms/execution-engine.ts`
    - `src/server/rooms/runtime-engine-profile.ts`
    - `src/server/rooms/openclaw-runtime-engine-profile.ts`
    - `src/server/rooms/openclaw-execution-adapter.ts`
    - `src/server/configuration/connection-validation.ts`
    - `src/server/configuration/codex-oauth-flow.ts`

## Local Checks

- `codex --version` reports `codex-cli 0.118.0`.
- `codex app-server --help` is available and labels App Server as experimental.
- `codex app-server generate-json-schema --out <tmp>` succeeds.
- Generated App Server schema includes client requests for `thread/list`, `thread/read`, `thread/start`, `thread/resume`, `turn/start`, `turn/interrupt`, `account/read`, `account/login/start`, `account/logout`, `account/rateLimits/read`, `model/list`, `config/read`, `config/batchWrite`, `config/mcpServer/reload`, `mcpServerStatus/list`, `mcpServer/oauth/login`, `app/list`, `plugin/list`, `skills/list`, and file/command operations.
- Generated schema includes server requests for command approval, file change approval, permissions approval, dynamic tool calls, user input requests, MCP elicitation, and external ChatGPT token refresh.
- Generated schema includes server notifications for account updates, login completion, thread status changes, turn start/completion, item deltas, tool progress, token usage, MCP startup status, MCP OAuth completion, and request resolution.

## Verdict

Codex App Server should be the first replacement spike, not Pi.

Pi is still a plausible fallback and a good lower-level substrate, but it is no longer the best first move if Codex OAuth is a hard requirement. App Server gives us the harness surface OpenClaw was trying to provide: long-lived process, typed bidirectional protocol, threads, turns, auth, approvals, model listing, streamed events, MCP state, and tool mediation. Pi gives a smaller core but forces Agent Room to rebuild more harness behavior immediately.

The right path is:

1. Spike Codex App Server behind the existing `RoomExecutionAdapter`.
2. Keep Agent Room as the source of truth for rooms, cron, entitlements, provider records, audit events, runtime lifecycle, and dashboard read models.
3. Keep Pi as the fallback plan if App Server fails the local-provider or provider-control gates.

This does not mean adopting the whole Codex desktop product. It means using the open-source Codex harness protocol as the per-room runtime interface, with Agent Room owning the orchestration layer around it.

## Provider Gate Matrix

| Gate                  | Codex App Server                                                                                                                                                                                                                                                                                                                                    | Pi                                                                                                                                                                        | Other direct SDKs                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Codex OAuth           | Strong fit. App Server exposes `account/login/start` for ChatGPT browser flow, device-code flow, API key flow, and experimental external tokens.                                                                                                                                                                                                    | Medium fit. Pi docs list ChatGPT Plus/Pro Codex subscription login, but also say OpenAI Codex subscription use is personal and production should use OpenAI Platform API. | Weak fit. Generic OpenAI/OpenRouter/Agents SDKs do not give the Codex OAuth lifecycle. |
| OpenRouter            | Strong enough to spike. Codex config supports custom providers with `base_url` and `env_key`; OpenRouter documents Codex CLI config using `model_provider = "openrouter"`, `base_url = "https://openrouter.ai/api/v1"`, and `OPENROUTER_API_KEY`. App Server uses Codex config, so this should carry through, but it needs direct smoke validation. | Strong. Pi docs list OpenRouter as an API-key provider.                                                                                                                   | Strong for OpenRouter-specific SDKs, but they do not solve Codex OAuth.                |
| Local providers       | Good for Ollama and LM Studio. Codex config reserves built-in provider IDs `ollama` and `lmstudio`, and `oss_provider` selects either for OSS mode. Arbitrary local OpenAI-compatible endpoints need a custom provider config smoke test.                                                                                                           | Good. Pi custom providers can register custom endpoints, and API-key providers are straightforward.                                                                       | Strong for hand-rolled providers, but all harness features become our responsibility.  |
| MCP                   | Stronger immediate fit. Codex supports stdio MCP, streamable HTTP MCP, bearer tokens, OAuth, allow/deny tool lists, startup and tool timeouts, and App Server protocol has MCP status/login notifications.                                                                                                                                          | Medium. Pi extension model can support MCP, but Pi core does not ship MCP as a first-class feature.                                                                       | Depends on SDK. Usually more implementation work.                                      |
| Subagents             | Stronger immediate fit. Codex has subagent configuration, thread limits, depth limits, and model/sandbox settings.                                                                                                                                                                                                                                  | Medium. Feasible through Pi packages/extensions, not core.                                                                                                                | Usually custom.                                                                        |
| Cron                  | Do not inherit Codex app automations as product state. Agent Room should own cron either way.                                                                                                                                                                                                                                                       | Same. Agent Room should own cron.                                                                                                                                         | Same.                                                                                  |
| Isolation             | Good if launched per room with room-scoped config/auth/state. Needs a precise home/config isolation smoke test.                                                                                                                                                                                                                                     | Good if launched per room.                                                                                                                                                | Depends on our harness.                                                                |
| Runtime API stability | Medium. Docs present App Server as the integration surface, but local CLI marks it experimental. Generated schema should be pinned per Codex version.                                                                                                                                                                                               | Medium. Pi is moving quickly and is intentionally minimal.                                                                                                                | High control, high implementation burden.                                              |

## Why App Server Beats Pi For The First Spike

The current Agent Room OpenClaw adapter is not only an agent loop wrapper. It depends on OpenClaw for gateway transport, session list/read, send, abort, event subscription, cron commands, provider auth, model probing, and runtime truth. Pi covers the model/session/tool core, but not that gateway surface.

App Server covers much more of that surface directly:

- thread list/read/start/resume/fork/archive
- turn start, steer, and interrupt
- account read/login/logout/rate limit updates
- model list
- config read/write
- MCP server status and OAuth login
- command execution, file changes, dynamic tools, and approvals
- streamed item, reasoning, tool, token, and turn notifications
- generated TypeScript and JSON schemas per pinned Codex version

That means the migration is mostly a protocol adapter plus room-scoped materialization, not a new agent harness.

## Why Pi Still Matters

Pi remains the best fallback if App Server blocks us on local-provider control, protocol churn, auth isolation, or licensing/packaging.

Pi's advantage is that it is small and more directly embeddable in a Bun/TypeScript service. Its disadvantage is exactly the same thing: Agent Room must own more of the harness immediately. For this product, that means we would have to rebuild MCP integration, subagent orchestration, permission mediation, richer thread semantics, provider auth ceremony, and the event/read-model bridge sooner.

The Pi-only replacement study in `plan/spikes/pi-replacement-feasibility.md` is still valid as a fallback architecture.

## Rejected Primary Options

### Direct OpenAI Responses API Plus OpenRouter Plus Local

This gives maximum provider control, but it gives up the Codex harness. Agent Room would own the agent loop, tool policy, command execution, patch application, streaming protocol, compaction, file context, approval semantics, MCP bridge, and Codex OAuth replacement. It is a reasonable long-term "own everything" direction only if Codex App Server and Pi both fail.

### OpenAI Agents SDK

The Agents SDK is a good application-agent toolkit, but it is not the Codex coding harness. It does not solve Codex OAuth as a drop-in product requirement, and it shifts the coding-specific runtime surface back into Agent Room.

### OpenRouter Agent SDK

This is useful for OpenRouter-native agents, but it fails the Codex OAuth gate and does not cover local providers as cleanly as a harness-level runtime. It is not the right primary backend for Agent Room.

### Codex SDK Instead Of App Server

Codex docs position the SDK for programmatic control and automation, while App Server is for deep product integrations with authentication, history, approvals, and streamed agent events. Agent Room is closer to a rich client/runtime orchestrator than a CI job runner, so App Server is the better first target.

## Replacement Mechanics

### Runtime Process

Add a Codex runtime profile parallel to the current OpenClaw profile:

- `src/server/rooms/codex-runtime-engine-profile.ts`
- `src/server/rooms/codex-runtime-config.ts`
- `src/server/rooms/codex-execution-adapter.ts`
- optional `src/server/codex-runtime/main.ts`

Do not wire App Server directly into the web server process. Keep the current per-room runtime isolation model.

Recommended production shape:

1. Agent Room starts one small room runtime process.
2. The room runtime process starts `codex app-server --listen stdio://`.
3. The room runtime owns the JSONL App Server client, backpressure, restart behavior, health, and log redaction.
4. The room runtime exposes Agent Room's small loopback API using the same token/metadata pattern the OpenClaw runtime uses today.

Fast spike option:

- Start `codex app-server --listen ws://127.0.0.1:<port>` and use WebSocket directly.
- Use only loopback plus a token file.
- Treat this as a spike only, because OpenAI docs mark the WebSocket transport experimental and unsupported.

### Room-Scoped State

The main state question is how to isolate Codex's home directory and auth cache. OpenAI auth docs describe auth cache under `~/.codex/auth.json`, and config docs describe `~/.codex/config.toml`. The runtime must prove that a room can run with a room-local Codex home or a room-local `HOME` so that:

- `auth.json` is stored under the room's runtime state
- `config.toml` is generated from Agent Room canonical config
- MCP config is materialized only from room entitlements
- sessions and logs do not leave the room boundary
- no process reads the operator's personal global Codex config unless explicitly allowed

Proposed state layout:

```text
rooms/<roomId>/
    workspace/
    store/
    runtime/
        codex-runtime.config.json
        codex.env
        logs/codex-runtime.log
        runtime-token
        runtime-metadata.json
        runtime-health.json
    codex-state/
        config.toml
        auth.json
        sessions/
        skills/
        agents/
        plugins/
        logs/
```

### Provider Materialization

Agent Room remains the canonical provider source. Codex config is generated state.

For OpenRouter:

```toml
model_provider = "openrouter"
model = "openai/gpt-5.3-codex"

[model_providers.openrouter]
name = "openrouter"
base_url = "https://openrouter.ai/api/v1"
env_key = "OPENROUTER_API_KEY"
```

For local Ollama or LM Studio:

```toml
model_provider = "ollama"
oss_provider = "ollama"
```

or:

```toml
model_provider = "lmstudio"
oss_provider = "lmstudio"
```

For arbitrary local OpenAI-compatible endpoints, spike a custom provider with room-local `base_url`, `env_key`, and a generated model catalog if needed. Do not silently map unknown local endpoints to built-in OpenAI.

### Codex OAuth

Replace the current OpenClaw `expect` flow with App Server auth endpoints.

Current behavior in `src/server/configuration/codex-oauth-flow.ts` spawns:

```text
openclaw models auth login --provider openai-codex --method oauth
```

Target behavior:

- start the room App Server with room-scoped state
- call `account/read`
- call `account/login/start` with `type = "chatgptDeviceCode"` for the default UX
- show `verificationUrl` and `userCode` in the Agent Room UI
- record `account/login/completed` and `account/updated`
- verify `account/read` shows `authMode = "chatgpt"`
- write an audit event binding user, room, provider, auth mode, and plan type

Browser callback login can be a later option. Device-code login is a cleaner first fit for self-hosted room runtimes because it does not require proxying localhost callback URLs through the Agent Room UI.

### Execution Adapter Mapping

Map the existing `RoomExecutionAdapter` contract as follows:

| Agent Room method                           | App Server mechanics                                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `listRoomsWithRuntime`                      | keep current DB/runtime metadata path                                                                                    |
| `getRoomExecutionSnapshot`                  | `thread/list`, `thread/read`, App Server token usage/status notifications, app-side read model                           |
| `sendRoomThreadMessage`                     | `turn/start` against a loaded thread, or `thread/start` for first message                                                |
| `abortRoomThreadMessage`                    | `turn/interrupt`                                                                                                         |
| `createRoomSessionEventStream`              | translate App Server server notifications to current SSE event shape                                                     |
| `createRoomThread`                          | `thread/start` without initial turn where possible, otherwise create app-side pending thread then start on first message |
| `listRoomCronJobs` and related cron methods | Agent Room DB scheduler, not App Server or Codex app automations                                                         |
| `wakeRoomRuntime`                           | app-side scheduler/send path; no OpenClaw `wake` equivalent needed                                                       |
| `getRoomExecutionTruthSnapshot`             | combine runtime metadata, App Server thread/account/model state, and app-side session index                              |
| `listRoomRunHistory`                        | Agent Room DB run history                                                                                                |

### Cron

Do not adopt Codex app automations as Agent Room cron state.

Codex app automations are useful evidence that the harness can run recurring unattended tasks, but Agent Room needs auditable room-owned scheduling:

- cron job table
- run table
- room lock
- job lock
- provider/model snapshot per run
- entitlement snapshot per run
- explicit failure state
- no hidden retry/fallback path

Each scheduled run should call the same `sendRoomThreadMessage` path as a manual message.

### MCP

Prefer Codex MCP config over a custom Pi MCP bridge for the App Server spike, but keep Agent Room as the entitlement source.

Materialization rules:

- generate only `[mcp_servers.<name>]` entries allowed by room entitlements
- set `enabled_tools` for allow-listed tools
- use `disabled_tools` only as a defense-in-depth deny list, not as the primary entitlement model
- set `required = true` only when the room must fail closed if the server cannot start
- pass secrets through named env vars, not static config values
- consume `mcpServerStatus/list`, `mcpServer/startupStatus/updated`, and `mcpServer/oauthLogin/completed`

### Subagents

Do not make subagents a gate for dropping OpenClaw. App Server has a more mature subagent path than Pi core, but Agent Room should introduce subagents as a separate first-class product feature after manual chat, provider auth, streaming, MCP, and cron are stable.

The important early decision is to keep subagent concurrency limits room-owned. Codex subagent config can enforce local harness limits, but Agent Room should still own product-level concurrency, billing/audit, and room isolation rules.

## Spike Plan

### Phase 1: Provider-Gated App Server Smoke

Create a throwaway spike script, not production code.

Success criteria:

- start `codex app-server` under a temp room-local state root
- initialize the protocol
- call `account/read`
- call `model/list`
- generate a config for OpenRouter and confirm `requiresOpenaiAuth` is false
- generate a config for Codex OAuth and confirm `requiresOpenaiAuth` is true
- start device-code login and confirm the server returns `verificationUrl` and `userCode`
- start with Ollama or LM Studio config and confirm the local provider is visible
- confirm no files are written outside the temp room state

### Phase 2: Manual Chat Adapter

Implement a hidden runtime setting that selects Codex App Server instead of OpenClaw for one test room.

Success criteria:

- room starts and stops cleanly
- thread list/read works
- one message streams through the existing room UI
- abort works
- event stream cannot cross room boundaries
- provider identity shown in the UI matches the materialized Codex config

### Phase 3: Provider Auth And Validation

Replace OpenClaw provider validation for Codex rooms.

Success criteria:

- OpenRouter probe uses the same config/env path as rooms
- local probe uses the same config/env path as rooms
- Codex OAuth device flow creates room-scoped auth
- failed auth/provider mismatch fails closed
- audit events record room, user, provider, model, and auth mode

### Phase 4: Agent Room Cron

Implement cron in Agent Room, not in Codex.

Success criteria:

- scheduled runs survive server restart
- run history is queryable without parsing Codex internals
- scheduled send uses the same adapter path as manual send
- run failures are bounded and visible

### Phase 5: MCP Entitlements

Materialize Codex MCP config from Agent Room entitlements.

Success criteria:

- allowed stdio MCP starts with bounded env
- allowed HTTP MCP starts with explicit auth headers
- denied MCP server is absent from Codex config
- denied tool cannot be called
- MCP startup failure fails closed when required

## Effort Estimate

Codex App Server smoke with provider gates: 1 to 2 days.

Manual chat parity behind `RoomExecutionAdapter`: 3 to 6 days after the smoke passes.

Production replacement including OAuth, provider validation, room-scoped state, MCP, cron, audit events, Docker packaging, tests, and OpenClaw removal: 2 to 4 weeks.

The estimate is lower risk than the Pi-only path because App Server already owns more of the harness behavior. The main risk moves from "we must build the missing harness" to "we must prove App Server can be isolated and pinned safely enough for self-hosted room runtimes".

## Main Risks

### App Server Maturity

Local CLI labels App Server experimental. Pin the Codex version, generate protocol schemas in CI, and treat protocol changes as explicit upgrades.

### State Isolation

This is the first pass/fail test. If Codex cannot reliably run with room-local config, auth, sessions, skills, plugins, logs, and MCP config, do not proceed with App Server as the primary backend.

### Provider Truth

OpenRouter and local providers must be validated through the same materialized config used by room runtimes. No separate "test" provider path.

### OAuth Boundary

Codex OAuth must be room-bound. A ChatGPT token for one room must not be visible to another room, and no global operator `~/.codex/auth.json` should be read by a room runtime by accident.

### WebSocket Temptation

The App Server WebSocket transport fits Agent Room's current port-based runtime lifecycle, but docs call it experimental and unsupported. Use stdio through a room runtime wrapper for production unless a pinned App Server version proves loopback WebSocket stable enough.

## Recommendation

Proceed with Codex App Server first.

Keep the Pi study as fallback, not as the primary replacement path. The App Server direction better matches the required provider set, especially Codex OAuth, and it maps more directly onto the current OpenClaw adapter responsibilities. Agent Room should still own cron, room state, entitlements, runtime lifecycle, audit, and provider records. Codex should own the coding harness loop, auth ceremony, model/provider execution, tool mediation, MCP runtime, threads, turns, and event stream.
