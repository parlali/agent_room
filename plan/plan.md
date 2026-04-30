# Agent Room - OpenClaw To Pi Migration Plan

Source of truth for the OpenClaw removal and Pi-wrapper migration. Plan items describe intended behavior, not mandatory implementation details. Check items as done only after direct behavior and downstream effects are verified.

## Current Verdict

Agent Room should remove OpenClaw as the room backend and replace it with an Agent Room-owned harness built around Pi.

The target shape is:

- Agent Room owns rooms, runtime lifecycle, provider truth, credential boundaries, MCP, cron, audit, session index, UI read models, files, prompts, and deployment.
- Pi owns the agent kernel: model calls, session execution, transcript files, streaming events, compaction, provider registry hooks, auth storage primitives, and tool execution hooks.
- The room runtime is a custom per-room Pi wrapper process, not raw Pi CLI and not OpenClaw Gateway.
- Codex App Server remains a reference or possible Codex-specific backend, not the primary runtime.

## Dependency Decision

Use Pi as a pinned npm dependency first. Do not copy Pi code into this repo for the initial migration.

Current discovery:

- package: `@mariozechner/pi-coding-agent`
- current npm version observed: `0.70.6`
- license observed from npm metadata: MIT
- repository observed from npm metadata: `github.com/badlogic/pi-mono`
- SDK docs explicitly support embedding with `createAgentSession`, `AgentSessionRuntime`, `AuthStorage`, `ModelRegistry`, `SessionManager`, `SettingsManager`, and custom `ResourceLoader`

Rules:

- Pin an exact Pi package version in `package.json` and `bun.lock`.
- Treat any Pi version bump as a deliberate runtime upgrade with schema/API smoke tests.
- Do not vendor or fork Pi unless the pinned package cannot satisfy isolation, provider, or patchability requirements.
- If vendoring becomes necessary, document the license obligations, fork point, patch set, and update policy before copying code.

## Deployment Constraint

The single Docker stack remains non-negotiable.

Target deploy behavior:

- `docker compose up -d --build` boots Postgres and Agent Room.
- The app image contains every runtime dependency needed to run room wrappers.
- No host OpenClaw install.
- No host Pi install.
- No host Codex install.
- No host provider auth files.
- No host `~/.pi`, `~/.codex`, or `~/.openclaw`.
- Room runtimes run inside the app container under the Agent Room data volume.

## Owner Questions To Resolve During Discovery

These are product decisions that cannot be proven from code alone.

- [x] Decide the minimum "local provider" contract for v0: Ollama and LM Studio only. Do not widen v0 to arbitrary OpenAI-compatible endpoints unless one of those two requires the same path.
- [x] Decide whether Codex OAuth is a hard launch gate or a post-Pi migration gate if terms or technical isolation are unclear. (Codex OAuth is a launch gate and the preferred first provider if only one provider ships.)
- [x] Decide initial file and shell policy: autonomous by default inside the room boundary, with read, search, write, edit, shell, and MCP tools available when enabled for the room. No per-action approval loop for normal operation; isolation, bounded config, audit, deny lists, timeouts, output limits, and kill switches are the control model.
- [x] Decide whether existing OpenClaw room state must be imported, archived read-only, or discarded during the migration. (Discard all OpenClaw runtime state and OpenClaw-specific UI/copy. Preserve functional Agent Room UI concepts such as MCP, provider config, rooms, jobs, files, audit, and settings, then wire them into Pi.)
- [x] Decide whether subagents are out of scope until after OpenClaw is removed. (Subagents are in target scope. Pi core does not ship subagents; Agent Room must implement them on top of Pi sessions/processes or a vetted Pi extension/package.)
- [x] Decide whether channel triggers such as Slack, email, Telegram, and webhooks are v0 migration scope or later integrations after cron and MCP are stable. (Out of v0 scope. Agent Room is the entire UI for now; revisit external channel triggers later.)

## Current OpenClaw Dependency Inventory

Observed OpenClaw surfaces that must be replaced or removed:

- `Dockerfile` installs global OpenClaw with `npm install --global "openclaw@${OPENCLAW_VERSION}"`.
- `src/server/rooms/runtime-engine-profile.ts` hardwires `openClawRuntimeEngineProfile`.
- `src/server/rooms/openclaw-runtime-engine-profile.ts` starts `openclaw gateway run` and writes OpenClaw env/config paths.
- `src/server/rooms/openclaw-config.ts` materializes provider, model, MCP, tool, workspace, and identity config into OpenClaw format.
- `src/server/rooms/openclaw-execution-adapter.ts` imports OpenClaw's bundled Gateway runtime module and maps Gateway methods.
- `src/server/rooms/execution-engine.ts` imports the OpenClaw adapter directly.
- `src/server/rooms/execution-types.ts` still imports `OpenClawSerializable`.
- `src/lib/openclaw-message.ts` normalizes OpenClaw message payloads and tool parts.
- `src/server/configuration/connection-validation.ts` probes providers through `openclaw models status`.
- `src/server/configuration/codex-oauth-flow.ts` drives `openclaw models auth login` through `expect`.
- tests under `src/server/rooms/*openclaw*`, readiness tests, provider tests, OAuth tests, and notice-copy tests encode OpenClaw assumptions.
- README and some UI copy still describe OpenClaw as the shipped runtime.

OpenClaw Gateway behavior currently used:

- `agents.list`
- `sessions.list`
- `sessions.get`
- `sessions.create`
- `sessions.send`
- `sessions.abort`
- `sessions.messages.subscribe`
- `sessions.subscribe`
- `cron.list`
- `cron.add`
- `cron.update`
- `cron.run`
- `cron.remove`
- `cron.runs`
- `wake`

## Phase 0 Discovery Findings

Discovery run date: 2026-04-29.

### Pi Package And Deployment

- `@mariozechner/pi-coding-agent@0.70.6` imports successfully through Bun from a throwaway TypeScript probe.
- npm metadata reports license `MIT`, repository `git+https://github.com/badlogic/pi-mono.git`, and tarball `https://registry.npmjs.org/@mariozechner/pi-coding-agent/-/pi-coding-agent-0.70.6.tgz`.
- The npm tarball did not include a top-level `LICENSE` file in the installed package; keep the MIT metadata and upstream repository license on the dependency review checklist before release.
- A throwaway `bun install` installed 249 packages and blocked postinstall scripts for `koffi@2.16.1` and `protobufjs@7.5.6`. Pi SDK import and the tested session paths worked without trusting those postinstalls.
- A disposable Linux Docker image based on `oven/bun:1.3.9` passed `bun install --frozen-lockfile` with Pi pinned and imported `createAgentSession`, `createReadOnlyTools`, and `VERSION` successfully.

### Pi Session And State

- The initial wrapper should use `createAgentSession` directly for manual chat and scheduled sends. `createAgentSessionRuntime`/`AgentSessionRuntime` are useful later for session replacement flows such as new, switch, fork, clone, and import.
- Room-local state works when the wrapper passes explicit paths: `AuthStorage.create(room/pi-state/auth.json)`, `ModelRegistry.create(authStorage, room/pi-state/models.json)`, `SessionManager.create(workspace, room/pi-state/sessions)`, `SettingsManager`, and `DefaultResourceLoader` with `cwd` and `agentDir`.
- A real fake-provider turn wrote a Pi JSONL session file under `room/pi-state/sessions`, and `SessionManager.list(workspace, sessionDir)` returned that file.
- Pi JSONL transcripts record provider/model/API identity on assistant messages and model changes. This is suitable for Agent Room's read model, but the app still needs its own thread index and reconciliation rules.
- Do not use Pi defaults in the wrapper. `getAgentDir()` resolves to `PI_CODING_AGENT_DIR` or `~/.pi/agent`, and `SessionManager.listAll()` reads the global session root.
- `DefaultResourceLoader` can discover global/project resources such as `.pi`, `.agents`, and `AGENTS.md`. The wrapper needs a custom or tightly configured resource loader so room prompts and context are app-owned and bounded.
- Auto-compaction can create extra model calls. In the fake-provider probe, disabling compaction removed an otherwise extra request. Agent Room should own compaction policy before enabling it.

### Provider Findings

- Installed Pi exposes built-in models for OpenRouter, native Google Gemini API, Google Gemini CLI OAuth, Google Antigravity OAuth, and OpenAI Codex subscription OAuth.
- Installed Pi does not expose built-in `ollama`, `lmstudio`, `lm-studio`, or `local-openai` provider IDs. Local providers must be materialized through room-local `models.json` custom provider entries or a registered custom provider.
- The owner-approved v0 local provider scope is Ollama and LM Studio only.
- OpenRouter Gemini models are present, but they use Pi's `openai-completions` API path against OpenRouter. That is not the same as Pi's native `google-generative-ai` Gemini path, and it still needs a live OpenRouter Gemini smoke before calling it production-ready.
- A fake OpenRouter override proved Agent Room can override the built-in OpenRouter base URL through `models.json`, stream a turn, and persist `provider: "openrouter"` plus the selected model in the transcript.
- A fake local OpenAI-compatible provider proved local-style custom models can stream and persist through Pi. Pi requires a non-empty `apiKey` for custom models; docs say Ollama ignores any value. The tested OpenAI-compatible path still sent a bearer header, so strict no-auth local servers may need a small custom provider/stream wrapper.
- Provider failures are event-stream facts, not thrown exceptions. A fake 401 produced an assistant message with `stopReason: "error"` and `errorMessage: "401 invalid api key"`, while `session.prompt()` resolved. A malformed fake response produced an empty stopped assistant message, so Agent Room should add provider-probe validation rather than trusting all Pi success-shaped events.

### Codex OAuth Findings

- Pi registers an `openai-codex` OAuth provider named `ChatGPT Plus/Pro (Codex Subscription)`.
- Pi's OpenAI Codex OAuth implementation uses callbacks for auth URL, prompt/manual code input, progress, and token refresh. It starts a local callback server at `http://localhost:1455/auth/callback` and can race manual code input with the browser callback.
- Room-local token storage should be possible through `AuthStorage.create(room/pi-state/auth.json)`, but this has not been verified with a real OpenAI login.
- Pi's provider docs state OpenAI Codex requires ChatGPT Plus or Pro, is personal-use only, and recommends the OpenAI Platform API for production. That makes Codex OAuth a product-policy gate, not just an implementation task.
- Owner decision: Codex OAuth is a launch gate and should be treated as the first provider priority. The migration should not claim launch readiness unless Codex OAuth works through the Pi path or the product direction is explicitly changed.

### Streaming, Abort, And Tools

- Text streaming maps cleanly to Pi events: `agent_start`, `turn_start`, `message_start`, `message_update:text_start`, `message_update:text_delta`, `message_update:text_end`, `turn_end`, and `agent_end`.
- `session.abort()` works as a core primitive. The abort smoke recorded an assistant message with `stopReason: "aborted"` and `errorMessage: "Request was aborted"`, then `session.isStreaming` became false.
- Pi custom tools work through the public SDK. A fake model tool call invoked a `defineTool` tool, emitted `tool_execution_start`, `tool_execution_update`, and `tool_execution_end`, persisted `toolCall` and `toolResult` transcript entries, and continued the model turn.
- This is enough evidence to build the MCP bridge as Agent Room-owned MCP clients exposed to Pi as custom tools. MCP process lifecycle, schema conversion, allowlists, redaction, timeout, and cancellation are still Agent Room work.
- Agent Room's target tool policy is fully autonomous operation inside the room boundary. Read, search, write, edit, bash, MCP, and subagent tools should not require per-action approval in normal operation.
- Built-in `bash` should be enabled through Agent Room-owned operations rather than blindly exposing Pi's default implementation. Pi's default bash tool supports custom operations, but its default implementation can write truncated full output under the OS temp directory. Agent Room should provide custom bash operations with room cwd, env allowlist, output bounds, timeouts, cancellation, audit events, and room-local logs.

### Harness Direction

- Use a supervised per-room Pi wrapper process with a loopback HTTP/SSE facade. This preserves the current isolation model, avoids loading Pi and provider state into the web server process, and keeps browser transport independent from Pi internals.
- The wrapper should keep one room-local Pi runtime service set and multiple app-indexed session handles for that room, rather than spawning one process per turn.
- Cron, wake, subagents, and channel triggers should not be re-created inside Pi core. Agent Room should own those features and call the same wrapper `send` path used by manual chat.
- Pi's installed README states that Pi core skips subagents and expects users to build them with extensions/packages or spawn Pi instances. Agent Room therefore needs an app-owned subagent harness on top of Pi rather than relying on a built-in Pi subagent API.
- External channel triggers such as Slack, email, Telegram, and webhooks are out of v0 scope. Agent Room is the complete operator UI until that decision is reopened.

## Phase 0 - Discovery And Spike Gates

Do not start broad migration work until these discovery items are answered with direct evidence.

### Pi SDK And Packaging

- [x] Add a throwaway local spike that imports `@mariozechner/pi-coding-agent` with Bun and TypeScript.
- [x] Verify the package works in the same runtime mode used by the production app image. (Disposable `oven/bun:1.3.9` image passed `bun install --frozen-lockfile` and SDK import.)
- [x] Verify exact package version, license text, transitive dependency risk, and lockfile stability. (Version/license/repository and frozen lockfile path verified; release hardening still needs dependency review because the tarball lacks a top-level `LICENSE` file and Bun blocks two transitive postinstalls.)
- [x] Verify whether `createAgentSession` or `createAgentSessionRuntime` is the better wrapper layer for room sessions. (`createAgentSession` first; `AgentSessionRuntime` later for replacement flows.)
- [x] Verify custom `agentDir`, `cwd`, `AuthStorage`, `ModelRegistry`, `SettingsManager`, and `SessionManager` keep all state under the room root.
- [x] Verify Pi can run without reading global `~/.pi`, `~/.agents`, host auth files, or project resources outside the room boundary. (Implemented with explicit room-local `AuthStorage`, `ModelRegistry`, `SessionManager`, `SettingsManager`, `PI_CODING_AGENT_DIR`, `HOME`, `TMPDIR`, and a bounded Agent Room resource loader; verified by wrapper and Docker smoke paths.)

### Provider Compatibility

- [ ] Run a provider smoke matrix through Pi for OpenRouter, local Ollama, local LM Studio, and at least one native Gemini path if supported. (Fake OpenRouter and fake local OpenAI-compatible paths passed; live providers still need credentials/endpoints.)
- [x] Record whether OpenRouter Gemini behaves as a first-class provider or suffers from OpenAI-shaped translation issues. (It uses `openai-completions` through OpenRouter, not Pi's native Gemini API path.)
- [x] Verify provider/model identity reported by Pi can be captured and shown in Agent Room.
- [x] Verify bad key, bad model, missing local endpoint, quota, timeout, and malformed provider response failure shapes. (Automated Pi-path validation tests cover bad key, bad model, unreachable local endpoint, quota/rate-limit, timeout, malformed response, wrong API, and provider/model mismatch through bounded fake providers; live provider smoke remains tracked separately.)
- [x] Decide whether custom local OpenAI-compatible endpoints need a Pi custom provider in v0. (Do not support arbitrary custom endpoints in v0; implement only Ollama and LM Studio, using custom provider materialization or a small custom stream wrapper where required. The app now enforces the supported v0 provider/API catalog instead of accepting arbitrary provider IDs.)

### Codex OAuth

- [ ] Verify Pi's ChatGPT or Codex subscription auth path can be driven headlessly or with a clean self-hosted browser/device flow. (SDK callbacks and manual-code path exist; real login not run.)
- [ ] Verify tokens can be stored only under the room state root. (The storage primitive supports this; real OAuth write not run.)
- [ ] Verify no global auth files are read or written. (Not complete until a real login is run with a fake home and room-local `AuthStorage`.)
- [ ] Verify terms and product posture for self-hosted user-owned Codex OAuth.
- [x] Decide whether Codex OAuth blocks OpenClaw removal or ships behind an explicit unsupported/pending provider state. (Codex OAuth blocks launch readiness.)

### Runtime Harness Shape

- [x] Choose wrapper transport: loopback HTTP, WebSocket, or stdio-supervised child with an app-owned HTTP facade. (Use a supervised per-room process with loopback HTTP/SSE.)
- [x] Define the wrapper API for health, snapshot, thread list/read/create, send, abort, events, provider probe, and shutdown. (Implemented as loopback HTTP/SSE plus SIGTERM shutdown; provider probes use the same Pi materialization path in validation.)
- [x] Decide whether one wrapper process can hold multiple active Pi sessions for one room or whether each active turn creates an isolated session handle. (One room-local process should hold the room runtime services and app-indexed session handles.)
- [x] Verify Pi event stream maps cleanly to the existing browser SSE model. (Text, tool, and abort event shapes were inspected.)
- [ ] Verify abort and queued message behavior with active tool calls. (Abort during text streaming verified; queued messages and abort during active tool execution still pending.)
- [ ] Verify compaction, session switching, fork, and resume behavior. (Auto-compaction is now enabled through an Agent Room policy with runtime/UI cues; forced overflow compaction, switching, fork, and resume still need live coverage.)

### MCP And Tooling

- [x] Specify the Agent Room-owned MCP bridge: stdio transport, HTTP transport, auth headers, initialization, tool schema conversion, allowlists, and redaction. (Implemented in `src/server/pi-runtime/mcp-bridge.ts` with automated stdio, HTTP auth, allowlist, schema failure, and redaction tests.)
- [x] Verify Pi custom tools can expose MCP tools without leaking denied tools. (Public `defineTool` execution path works; allowlist enforcement still belongs to the bridge implementation.)
- [x] Define builtin room tools for read, list, search, write, edit, shell, artifact import/export, and workspace browse. (Implemented as Agent Room-owned Pi custom tools in `src/server/pi-runtime/room-tools.ts` rather than Pi built-ins; tool profiles are now canonicalized to `coding`, `minimal`, and `read-only` across UI, server validation, DB constraints, and runtime.)
- [x] Decide default approval policy for shell commands, file writes, destructive operations, and external network tools. (Autonomous by default inside the room boundary; use hard isolation, allowlists/denylists, timeouts, output bounds, audit, and kill switches instead of normal per-action approvals.)
- [x] Verify tool output streaming, output bounding, timeout, and cancellation. (Covered by room tool tests for partial shell updates, output bounds, timeout, and abort-signal cancellation.)

### Data Model

- [x] Design app-owned tables for room threads, Pi session mapping, cron jobs, cron runs, provider validation attempts, and runtime events only where app ownership is required. (Migration adds only the canonical tables that are wired now: provider validation attempts plus cron jobs/runs. Dormant thread/runtime/subagent tables were removed to avoid duplicate sources of truth until those persistence paths are implemented.)
- [x] Decide whether message text remains Pi-owned only or whether Agent Room stores a read-model cache for dashboard performance. (Message text remains Pi-transcript-owned for now; Agent Room stores thread/run indexes and derives message read models from Pi JSONL files.)
- [x] Define reconciliation rules between app thread index and Pi transcript files. (Wrapper resolves threads from the app-owned thread index and Pi session files, updates thread previews from transcripts, and returns no selected thread when a requested key is not in the room index.)
- [x] Define import/archive policy for existing OpenClaw room state. (Discard all OpenClaw runtime state; remove OpenClaw-specific UI/copy; keep functional Agent Room surfaces and rewire them to Pi.)

### Docker And Operations

- [x] Build a disposable Docker image path with Pi installed through `bun install --frozen-lockfile`.
- [x] Verify room wrappers can spawn and run inside the existing app container.
- [x] Verify runtime logs, data, auth, sessions, and tool temp files stay under `AGENT_ROOM_DATA_DIR`. (Runtime logs/config/auth/sessions are under the data volume; room tool tests verify shell temp files stay under room-local `pi-state/tmp`.)
- [x] Verify restart behavior preserves room state and does not require host setup. (Verified with a Docker smoke room, app restart reconciliation, session reload, and runtime pause cleanup.)

## Phase 1 - Runtime-Neutral Contract Cleanup

Goal: make the existing code ready to host Pi without carrying OpenClaw names through shared contracts.

- [x] Replace `OpenClawSerializable` with a runtime-neutral JSON value type.
- [x] Replace `src/lib/openclaw-message.ts` with runtime-neutral message part helpers, keeping OpenClaw-specific parsing only behind temporary adapter code.
- [x] Move `RoomExecutionAdapter` into an exported runtime-neutral module that both OpenClaw and Pi adapters can implement during migration.
- [x] Remove OpenClaw-specific unsupported edit-message copy from shared capability construction.
- [x] Add runtime kind to internal metadata without exposing a user-facing engine selector.
- [x] Add tests that prove route/server functions depend only on the runtime-neutral adapter contract. (Facade tests mock the Pi adapter behind the runtime-neutral execution engine contract.)

## Phase 2 - Pi Wrapper Skeleton

Goal: create a real per-room wrapper process that starts, health-checks, and owns room-local Pi state.

- [x] Add `@mariozechner/pi-coding-agent` as an exact pinned dependency.
- [x] Add `src/server/pi-runtime/main.ts` as the wrapper process entrypoint.
- [x] Add `src/server/rooms/pi-runtime-engine-profile.ts`.
- [x] Add `src/server/rooms/pi-runtime-config.ts`.
- [x] Add `src/server/rooms/pi-runtime-client.ts`.
- [x] Materialize `pi-runtime.config.json`, `pi-runtime.env`, `pi-state/`, `workspace/`, and `store/` under each room root.
- [x] Start the wrapper with Bun inside the app container.
- [x] Implement `/health` or equivalent wrapper health check.
- [x] Prove one room can start and stop the Pi wrapper without invoking any OpenClaw binary. (Verified in Docker with resume, health, pause, DB metadata, and process inspection.)
- [x] Add tests for room path layout, env materialization, token handling, and lifecycle failure. (Pi runtime config/profile tests cover paths, `HOME`, `TMPDIR`, state dirs, and runtime token env; readiness tests cover lifecycle fail-closed behavior.)

## Phase 3 - Manual Chat Parity

Goal: one room, one provider, one session, streaming chat through the existing UI.

- [x] Implement `src/server/rooms/pi-execution-adapter.ts`.
- [x] Replace the execution-engine loader so Pi can be selected internally for a test room or test environment. (Pi is now the production runtime.)
- [x] Implement thread creation with app-owned `threadKey` and Pi session file mapping.
- [x] Implement thread list/read using app thread index plus Pi transcript files.
- [x] Implement send through Pi `prompt`.
- [x] Implement abort through Pi `abort`.
- [x] Translate Pi events to the existing browser SSE event shape.
- [ ] Render text deltas, final assistant messages, tool starts, tool updates, tool ends, errors, and interrupted runs. (Text/final/error path and session header rendering verified; tool event rendering still needs an explicit UI smoke.)
- [x] Verify selected thread cannot cross room boundaries. (Wrapper selection now returns no selected thread for keys outside the room index; browser smoke verified another room does not display the source room's session.)
- [x] Verify provider/model identity appears correctly in the room UI. (Browser smoke verified `ollama / smoke-model` in the Pi session header.)
- [x] Verify app restart can reload room threads and continue reading Pi sessions.

## Phase 4 - Provider Validation And Auth

Goal: remove OpenClaw as the provider probe and auth owner.

- [x] Replace `openclaw models status` validation with a Pi-native probe using the exact same room materialization path.
- [x] Implement OpenRouter provider materialization and validation.
- [x] Implement local provider materialization and validation for the owner-approved v0 local provider scope.
- [x] Implement Ollama and LM Studio provider materialization, using Pi custom model config or a small custom stream wrapper where required.
- [x] Implement room-scoped API-key handling through runtime-only keys or room-local auth files, never shared global auth.
- [x] Implement Codex OAuth as a launch gate with room-scoped token storage and no global auth file reads or writes. (Implemented through Pi `AuthStorage.login`; real OAuth login remains unverified.)
- [x] Update settings and onboarding surfaces to report provider validation truth from the Pi path.
- [x] Add failure-mode tests for bad credentials, missing model, bad base URL, wrong provider API, and provider mismatch.

## Phase 5 - Agent Room-Owned MCP Bridge

Goal: replace OpenClaw MCP materialization with an app-owned MCP-to-Pi bridge.

- [x] Add typed MCP runtime config generated from existing app-scoped and room-scoped MCP definitions.
- [x] Implement stdio MCP client startup with bounded env and startup timeout.
- [x] Implement HTTP or streamable HTTP MCP client connection with explicit headers.
- [x] Convert MCP tool schemas to Pi custom tools.
- [x] Enforce room allowlists before registering tools with Pi.
- [x] Redact secrets from MCP tool inputs, outputs, errors, logs, and browser events.
- [x] Fail closed when a required MCP server cannot initialize.
- [x] Add tests for stdio success, stdio failure, HTTP auth, denied tools, schema conversion failure, and secret redaction.

## Phase 6 - Prompt, Context, Files, And Shell

Goal: own the harness behavior that OpenClaw previously hid.

- [x] Build the Agent Room system prompt builder for room identity, instructions, provider path, tool policy, scheduling context, artifact policy, and credential safety. (Bounded prompt builder is wired into the Pi wrapper and covered by tests.)
- [x] Implement hidden room-internal markdown state for memory, plan, tasks, and decisions. (Stored under room Pi state, excluded from user-visible workspace/store files, exposed only through bounded internal-state tools.)
- [x] Add a lightweight harness prompt so Pi uses internal state for multi-step work without recreating OpenClaw's larger runtime stack. (Prompt injection uses a capped internal-state summary; tools enforce per-document caps and optimistic updates.)
- [x] Enable auto-compaction with an Agent Room policy and browser-visible cues. (Pi auto-compaction is configured in the materialized runtime config, compaction events update thread state, and the chat header/system messages show compaction status.)
- [x] Load `AGENTS.md` and other instruction files only through explicit bounded room/workspace rules.
- [x] Define context budgeting per provider/model before sending prompts.
- [x] Implement room file tools with workspace-only path enforcement. (Read/list/search/write/edit are rooted to the room workspace or store and reject traversal.)
- [x] Implement artifact import/export tools between `workspace/` and `store/`.
- [x] Implement autonomous shell tool policy with room cwd, timeout, output bounds, env allowlist, kill switch, and audit behavior. (Shell runs from room cwd with minimal env, bounded output, timeout/cancel support, audit events, and profile-level shell disable.)
- [x] Implement structured file change events or diffs for UI rendering. (Room write/edit/import/export tools now emit structured file-change details with hashes, byte counts, and bounded diffs.)
- [x] Add tests for path traversal denial, secret env denial, output bounding, cancellation, and artifact provenance.

## Phase 7 - Agent Room-Owned Cron And Wake

Goal: move unattended work out of OpenClaw and into auditable app-owned state.

- [x] Add DB tables for cron jobs, cron runs, run attempts, and run locks. (Migration adds DB-backed jobs/runs, attempts, lock token, and lock expiry fields.)
- [x] Implement scheduler loop in the Agent Room server. (Docker logs verify the scheduler starts with the app server.)
- [x] Implement per-room and per-job locking. (DB claims use per-job lock tokens and bounded lock expiry; adapter tests cover locked run-now behavior.)
- [x] Send scheduled runs through the same Pi adapter path as manual messages. (Adapter tests prove due jobs create a Pi thread and call the same send path with cron-only `awaitCompletion` so runs are not marked complete at mere prompt acceptance.)
- [x] Record provider/model snapshot and entitlement/config version per run. (Cron jobs and runs persist provider/model/config snapshots; browser and DB smoke verified the stored snapshot.)
- [x] Implement run-now, enable, disable, edit, remove, and history surfaces. (Server/UI surfaces are wired; browser smoke verified create, disable, and real in-place edit, while run-now/remove/history are covered by server/adapter paths without firing a live model.)
- [x] Replace `wake` with an app-owned send path using explicit target thread/session behavior. (Wake now snapshots the room, sends to the selected/thread-list target, or creates a new Pi thread with the wake text; adapter tests cover both paths.)
- [x] Verify scheduled runs survive stack restart. (Disabled cron job persisted across app restart with no pending next run.)
- [ ] Add tests for missed schedules, disabled jobs, overlapping runs, runtime unavailable, provider failure, and restart recovery. (Adapter tests now cover due runs, locked run-now, blocked provider failure, Pi turn-error failure, and no-Pi failure path; missed schedule and restart-recovery tests remain open.)

## Phase 8 - Agent Room-Owned Subagents

Goal: add autonomous subagents on top of Pi without assuming Pi core owns the orchestration.

- [ ] Define the subagent contract: name, purpose, prompt, provider/model policy, tool policy, workspace scope, concurrency limit, and parent-room ownership.
- [x] Decide whether each subagent is a nested Pi session in the same room wrapper, a child wrapper process, or a separate room-scoped process group. (Initial implementation uses a nested Pi session in the same room wrapper.)
- [ ] Implement subagent spawn, status, cancel, and result collection through Agent Room-owned state.
- [x] Expose subagents to the parent agent as Pi custom tools with explicit schemas and bounded outputs. (Basic custom tool implemented; persistence and UI audit remain open.)
- [ ] Persist subagent runs, parent/child links, provider/model snapshots, tool access, and transcript/session paths for audit.
- [ ] Enforce room isolation so a subagent cannot access another room's workspace, store, auth, MCP tools, or sessions.
- [ ] Add UI/read-model surfaces for active and completed subagent work without making OpenClaw-style agents a product concept.
- [ ] Add tests for parallel runs, cancellation, failed child runs, parent run continuation, audit history, and restart recovery.

## Phase 9 - UI And Onboarding Migration

Goal: keep product behavior coherent while the runtime changes.

- [x] Update room status, truth, sessions, jobs, files, settings, onboarding, and notices to use Pi-wrapper terminology only where runtime details are needed.
- [x] Remove OpenClaw-facing copy from normal product UI.
- [x] Update onboarding to validate Pi provider readiness and create a first usable Pi-backed room. (First-room creation now attempts Pi thread creation after provider validation and reports blocked reasons when thread creation fails.)
- [x] Make the first-room flow end in a selected thread with either a successful first task or an explicit blocked reason.
- [x] Keep existing room-first navigation and visual model intact. (Also fixed the child route outlet bug that blocked session/status/settings child pages.)
- [x] Split large settings and room workspace modules only where needed to keep the migration maintainable. (Diff review found no duplicated runtime/provider truth needing another split in this migration pass; the large settings route files remain future UI refactor candidates, not migration blockers.)

## Phase 10 - OpenClaw Removal

Goal: remove OpenClaw from shipped code and deploy artifacts.

- [x] Remove global OpenClaw install from `Dockerfile`.
- [x] Remove Node installation from Dockerfile if it was only needed for OpenClaw.
- [x] Remove `openclaw-runtime-engine-profile.ts`.
- [x] Remove `openclaw-config.ts`.
- [x] Remove `openclaw-execution-adapter.ts` after Pi adapter passes parity.
- [x] Remove `src/lib/openclaw-message.ts` after all message parsing is runtime-neutral or Pi-specific.
- [x] Remove OpenClaw provider validation code.
- [x] Remove OpenClaw Codex OAuth `expect` flow.
- [x] Remove OpenClaw tests or rewrite them around Pi wrapper behavior.
- [x] Remove OpenClaw references from README, setup docs, Docker docs, and normal UI copy.
- [x] Keep historical spike docs under `plan/spikes/` unless they become misleading.

## Phase 11 - Full Single-Stack Verification

Goal: prove the migration works as a complete product, not just a runtime spike.

- [x] Build the Docker image from scratch.
- [x] Boot empty volumes with `docker compose up -d --build`. (Verified with `docker-compose.empty-verify.yml` on isolated ports/volumes; temporary containers were stopped and the normal stack was restored.)
- [x] Recover root credentials and log in.
- [ ] Complete onboarding with Codex OAuth through the Pi path.
- [x] Create a Pi-backed room. (Verified with a no-secret local-compatible fake provider.)
- [ ] Send a manual task and observe streamed text and tool events. (Verified streamed text through the browser; explicit tool-event smoke remains open.)
- [ ] Add an MCP connection, bind it to the room, and invoke an allowed MCP tool.
- [ ] Create a cron job, run it now, wait for a scheduled run, and inspect run history.
- [ ] Spawn a subagent, observe parent/child status, and inspect persisted audit/run history.
- [ ] Restart the stack and verify room state, sessions, provider binding, cron, run history, artifacts, and audit events persist. (Verified room/session/provider/runtime state and cron job persistence; run-history/subagent persistence still need live run coverage.)
- [x] Verify no OpenClaw binary, package, env var, state directory, or runtime process is present in the shipped stack.
- [ ] Verify no plaintext secrets leak in UI payloads, logs, room files outside intended secret materialization, provider errors, or MCP output. (Code hardening now bounds runtime/MCP child env, redacts runtime events and MCP outputs, removes generated root passwords from automatic app logs, and tests representative leak paths; live provider/MCP smoke remains open.)
- [x] Run `bun run lint`, `bun run typecheck`, `bun run test`, and `bun run build`.

## Closeout Gate

The migration is not complete until all of the following are true:

- [x] A new room can execute a manual Pi-backed task in the single Docker stack. (Verified with a fake local OpenAI-compatible provider.)
- [ ] OpenRouter works through Pi with provider/model identity visible.
- [ ] The approved local provider scope works through Pi.
- [ ] Codex OAuth is implemented safely through Pi and works as the launch provider.
- [ ] MCP works through Agent Room's bridge with enforced tool allowlists.
- [ ] Cron works through Agent Room-owned DB state and Pi send path.
- [ ] Subagents work through Agent Room-owned Pi session/process orchestration with audit-visible parent/child state.
- [ ] No room runtime reads or writes global host auth/runtime state.
- [x] OpenClaw is removed from Docker packaging and production runtime code.
- [x] Architecture, context, README, and onboarding docs match the Pi-wrapper product reality.
