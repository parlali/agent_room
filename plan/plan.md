# Agent Room — Plan

Source of truth for progress. Nothing here is implementation. Phase 0 proved the wedge and established that the market is real enough to build for. Before shipping the first deploy/readme path, we now need to lock the architecture, product contract, and canonical operating model.

Plan items describe intended behavior to achieve. Implement the smallest correct design that satisfies the behavior. Check items as done: `- [ ]` → `- [x]`. Add brief notes in parens when findings differ from the wording.

## Phase 0 — Commit to the wedge and de-risk only what blocks v0

### Positioning

- [x] Decide whether to proceed greenfield or fork/contribute elsewhere (current decision: greenfield; desk review says Mission Control / Clutch / ClawAgentHub are adjacent but not room-first)
- [x] Write a brief competitor note covering Mission Control, Clutch, and ClawAgentHub: what they do well, why they do not eliminate the Agent Room gap, and what to steal anyway (captured in `README.md` and prior desk review; no hands-on repo runs yet)
- [x] Stand up Mission Control (`builderz-labs/mission-control`) only to harvest specific UI and deploy lessons, not as a gate to building. (closed by repo/docs/screenshots review instead of running it; steal deploy clarity, live ops surfaces, and admin polish, but do not fork the task-board/adapters shape)
- [x] Skim Agent Zero, Hermes Agent, and Anthropic Claude Managed Agents only for UX ideas worth stealing. No more broad market-proof work unless it changes product direction. (desk review only; Agent Zero is hierarchical framework-first, Hermes is single persistent agent plus gateway, Managed Agents is hosted meta-harness; useful ideas captured in `context.md`)

### OpenClaw Gateway spike

- [x] Install OpenClaw locally (`openclaw onboard` on Mac). (closed by docs/repo review instead of local install per desk-research constraint; onboarding path is clear enough and not the blocker)
- [x] Create 2 distinct agents with distinct `agentDir`s. Confirm workspace and memory isolation on disk. (docs and config semantics explicitly define isolated workspace, `agentDir`, auth profiles, and per-agent sessions; reusing `agentDir` is documented as unsafe)
- [x] Add a cron job targeting agent A only. Trigger it. Confirm A runs, B does not. (desk review of cron docs/store/code shows per-job agent targeting and isolated cron sessions; enough to unblock UI shape without live trigger proof)
- [x] Set up `/hooks/agent` with a bearer token. Curl the endpoint targeting agent B. Confirm isolation. (docs, `src/gateway/hooks.ts`, and `src/gateway/server.hooks.test.ts` confirm bearer auth, explicit `agentId` routing, allowlists, and target-session rebinding)
- [x] Open a WebSocket to `:18789`. Send a chat to agent A, stream events, confirm event shape and per-agent scoping. (protocol docs plus gateway/client tests show one WS connection can multiplex `chat`, `agent`, and `sessions.changed` events with `sessionKey` and run metadata)
- [x] Reproduce the bundled Control UI pinning to `agent:main:main` (issue #45086). (closed by issue/code review instead of runtime repro; open issues #45086 and #32495 plus Control UI session alias handling confirm the limitation is real)
- [x] Write findings into `spikes/openclaw-gateway.md`.

### Product decisions to lock before building deep

- [x] Default room view: chat / activity feed / hybrid. (hybrid: activity-first room with chat always visible; rooms must prove unattended behavior and direct conversation in one surface)
- [x] Trigger config UX: per-type forms / JSON editor. (per-type forms first; add bounded raw JSON escape hatch later only if OpenClaw surfaces a stable schema we can round-trip safely)
- [x] Local SQLite for UI prefs: needed or not. (not for v0; prefer URL/localStorage and Gateway/disk truth, add persistence only if a clearly UI-local need survives usage)
- [x] Lock the room isolation model for v0.1. (2026-04-23 alignment: exactly one dedicated OpenClaw runtime per room in the canonical Dockerized stack; no sandbox modes, no host OpenClaw path, no NemoClaw surface)
- [x] Deployment story for v0.1: local `docker-compose` first, with the smallest possible setup that gets OpenClaw + Agent Room running reliably. (single canonical path only; full functionality must work inside the stack with no extra host prerequisite)

## Phase 1 — Architecture, product contract, and canonical operating model

Locked direction for this phase:
per-room execution-engine cells behind one Agent Room UX; TanStack Start on Bun/TypeScript; OpenClaw as the initial execution-engine adapter; bounded managed config; operator/local-first UX; built-in auth with an app DB; durable room `store/`; hard isolation via per-room runtime/config/credential boundaries.

Implementation defaults locked so far:

- Postgres in Docker for the app DB
- `dbmate` for migrations
- no Prisma
- no Convex
- one room-scoped execution-engine instance per room managed by Agent Room (initial adapter: OpenClaw)
- one canonical Dockerized OpenClaw path for every room runtime; no sandbox choice in the product surface
- dynamic loopback-only port allocation for room runtimes
- secrets encrypted in the app DB and materialized only into the target room runtime
- MCP servers not hosted by Agent Room; only selectively exposed into per-room OpenClaw config
- root-password-based built-in auth for the initial self-hosted operator model
- canonical room execution contract between control plane and runtime adapter so OpenClaw can be swapped later without control-plane rewrites

- [x] Write `architecture.md` that captures the locked topology, trust boundary, and responsibility split between Agent Room and OpenClaw. (implemented as the single canonical Phase 1 spec document)
- [x] Write the runtime/cell spec: what one room provisions (`OPENCLAW_CONFIG_PATH`, `OPENCLAW_STATE_DIR`, workspace, token, port, plugin/MCP config, and isolation boundary). (captured in `architecture.md` under `Room Cell Runtime Spec`)
- [x] Write the data ownership spec: what lives in the Agent Room DB versus what stays in OpenClaw files and state. (captured in `architecture.md` under `Data Ownership Spec`)
- [x] Write the integrations/entitlements spec: how mail, calendar, GitHub, MCP servers, and provider credentials are granted to a room and materialized into its OpenClaw cell. (captured in `architecture.md` under `Integrations And Entitlements Spec`)
- [x] Write the file/artifact spec: chat attachments versus durable `store/` artifacts versus explicit cross-room share/import. (captured in `architecture.md` under `File And Artifact Spec`)
- [x] Write the auth spec: local-first built-in auth/session model, reverse-proxy assumptions, and minimum security posture for self-hosting. (captured in `architecture.md` under `Auth Spec`)
- [x] Write the realtime/chat spec: direct Gateway WS/HTTP handling, session scoping, streaming rendering, tool-call rendering, and multi-room concurrency assumptions. (captured in `architecture.md` under `Realtime And Chat Spec`)
- [x] Write the setup UX spec: bounded Agent Room-managed config surface, explicit advanced/raw escape hatch, and fail-closed validation rules. (captured in `architecture.md` under `Setup UX Spec`)

## Phase 2 — Stack bootstrap and local runtime foundation

- [x] Bootstrap the frontend stack with Bun, TypeScript, TanStack Start, Router, Query, linting, formatting, and the initial app shell. (implemented in the root app scaffold with TanStack Start routes, Query provider, Bun scripts, ESLint, and Prettier)
- [x] Bootstrap the app DB on Postgres with `dbmate` migrations and the initial schema for auth, rooms, entitlements, runtime metadata, secret metadata, and artifact indexing. (initial schema is in `db/migrations/202604210001_initial_schema.sql`; `scripts/dbmate.ts` provides Bun-driven migration commands)
- [x] Bootstrap the built-in auth/session layer with an initially onboarded root user and password-based login. (root bootstrap plus password login/session validation/revoke are implemented in `src/server/auth/auth-service.ts`, with a bootstrap script)
- [x] Bootstrap the room runtime manager that can create and manage per-room OpenClaw processes without exposing topology complexity in the UX. (implemented in `src/server/rooms/runtime-manager.ts` and `room-service.ts`)
- [x] Implement dynamic loopback-only port allocation and runtime health tracking for room processes. (implemented with `LoopbackPortAllocator` and periodic health snapshots persisted to runtime health metadata/files)
- [x] Bootstrap the initial typed config/materialization layer that turns room settings and entitlements into canonical OpenClaw config/state on disk. (implemented in `runtime-materializer.ts` + `openclaw-config.ts` with typed payloads)
- [x] Implement encrypted secret storage in the app DB and per-room secret materialization into runtime config/env. (AES-256-GCM encrypt/decrypt utilities and per-room secret/env materialization are in place)
- [x] Implement the canonical room filesystem layout on disk, including workspace, `store/`, runtime metadata, and logs. (implemented in `room-paths.ts` and used by runtime materialization/manager)
- [x] Implement MCP/config entitlement materialization so each room only receives the selectively exposed OpenClaw config it is allowed to use. (implemented with typed MCP scope validation and per-room projection in `entitlement-materialization.ts`)

## Phase 3 — README pitch and first deploy

- [x] Rewrite `README.md` around the room-first thesis: the agent is a colleague, not a session; OpenClaw owns runtime/state; Agent Room owns UX.
- [x] Add a crisp "why not Mission Control / Clutch / ClawAgentHub" section without overclaiming that nothing adjacent exists.
- [x] Ship a local quickstart using Bun and `docker-compose` with the fewest moving parts possible. (documented tested command path in `README.md`: Bun app + compose Postgres)
- [x] Make environment setup explicit and fail-closed: required URLs, tokens, ports, and any host filesystem mounts. (documented in `README.md` under `Environment Contract (Fail-Closed)`)
- [x] Decide whether OpenClaw is an external prerequisite or bundled in the default compose path, then document only one canonical path. (updated to bundled OpenClaw in the app image with single-stack `docker compose up -d --build` deploy)

## Phase 4 — Room-first UI shell

- [x] Build the room directory and navigation with obvious per-room identity and status. (implemented as the `/` room directory; room-internal agent switching was removed because one room is one isolated brain)
- [x] Build the room page as the primary object in the product, not a secondary modal off a task board. (moved to dedicated room route and made `/` a room directory that links into room workspaces)
- [x] Implement the chosen default room layout (chat / activity / hybrid) with enough fidelity to test the product thesis. (hybrid room workspace now combines a single room-brain summary, session timeline, chat pane, recent activity, and trigger controls)
- [x] Add session list, chat pane, and recent run/activity panel against real room runtime data through the execution adapter. (implemented via the typed OpenClaw gateway adapter and room runtime UI on `/rooms/$roomId`; sessions are chats within one room brain)
- [x] Add cron and trigger management only to the degree needed to prove unattended-agent behavior. (added typed runtime-backed cron list/create/run/enable/disable/remove and manual wake trigger dispatch against the room brain)

## Phase 5 — Execution truth in the UI

- [x] Use room execution-engine state and on-disk room runtime state as the source of truth. Do not mirror runtime state into a parallel app schema unless it is clearly UI-local. (added runtime+disk execution truth snapshot from gateway RPC plus room runtime files/state paths; no parallel execution table/state introduced)
- [x] Expose room-brain memory, workspace, sessions, and run history in ways that match the execution-engine semantics (OpenClaw first) instead of inventing new abstractions. (room page renders room session/chat surfaces while the execution-truth panel still exposes raw runtime agent dirs to detect drift)
- [x] Verify room-brain event scoping, thread/session linkage, and trigger ownership end to end before calling the room model validated. (ownership checks now treat the room runtime default agent as the room brain and surface extra runtime agents as drift rather than first-class UI state)
- [x] Keep persistence limited to UI-local concerns only if they are truly not derivable from runtime state or disk. (implemented with query-derived runtime/disk data only; no new persistence schema or mirrored execution storage)
- [x] Wire realtime chat execution through Agent Room instead of browser-direct runtime access. (implemented an authenticated app SSE proxy over OpenClaw Gateway `chat`, `session.message`, `session.tool`, and `sessions.changed` events, plus `sessions.abort`; message editing is explicitly reported unsupported because OpenClaw has no safe per-message edit RPC)

## Phase 6 — Onboarding and Runtime-Modularity Hardening

- [x] Enforce fail-closed room runtime prerequisite validation before room creation. (rewritten from sandbox gating to bundled OpenClaw readiness checks only)
- [x] Default first-room startup behavior from explicit runtime readiness instead of optimistic UI assumptions. (the single-path onboarding now blocks only on bundled runtime health, not option selection)
- [x] Add first-room onboarding readiness UX that shows blockers before provisioning. (rewritten to the single canonical OpenClaw path)
- [x] Isolate OpenClaw runtime process/profile specifics behind a runtime-engine profile boundary so runtime lifecycle and paths are engine-agnostic. (implemented `runtime-engine-profile.ts` and `openclaw-runtime-engine-profile.ts`, then rewired lifecycle/materialization/path resolution through the profile)
- [x] Add tests for readiness-based room provisioning behavior and keep lint/type/test gates green after refactor. (the sandbox-selection tests were replaced with single-path readiness coverage)
- [x] Remove sandbox state from persisted room data and runtime file contracts. (added migration `202604230001_remove_room_sandbox_mode.sql`; removed sandbox from domain, runtime metadata, and materialized OpenClaw config)
- [x] Remove user-facing sandbox and engine choice from room-creation contracts. (stripped sandbox from server schemas, room service inputs, onboarding form state, directory cards, and room truth panels)
- [x] Replace sandbox readiness with single-path deployment health checks for the bundled stack only. (readiness now only verifies the bundled OpenClaw command path and fails closed on blocking runtime issues)
- [x] Collapse runtime command/profile selection to the fixed bundled OpenClaw implementation while preserving a narrow internal adapter boundary. (removed env-driven engine/binary/arg selection; kept internal profile and adapter seams)
- [x] Remove sandbox and engine-choice leakage from execution truth and adapter payloads. (trimmed overview/truth types, adapter parsers, and runtime config readers)
- [x] Sweep architecture, README, env examples, and deployment files for leftover sandbox or multi-path language. (cleaned shipped env contract, compose file, and architecture wording to the single Dockerized path)
- [x] Replace readiness and room-service tests that encode sandbox selection behavior with tests for the single-path provisioning contract.
- [x] Run full verification for the runtime-shell rewrite and fix regressions before closing the phase. (build, lint, typecheck, test, Docker smoke, room creation, runtime start, and room-brain adapter path now pass; the remaining product-completeness verification is tracked below)

## Phase status — 2026-04-23 reset

- [x] Runtime-shell milestone: one room provisions one dedicated OpenClaw runtime in the canonical Docker stack, and the room workspace can start/stop the runtime, create sessions, chat, wake, and manage cron.
- [x] Product-completeness milestone: an operator can go from first boot to first useful room without touching code, the database, or raw runtime files. (verified through the UI with placeholder provider credentials; real provider success still requires operator-owned keys)

The plan below rewrites the remaining work around that product-completeness gap. We are still following the plan, but the next critical phases are no longer runtime bootstrapping. They are configuration, secure secret management, onboarding, and the real operator UX.

## Phase 7 — Canonical configuration and secret model

- [x] Replace the current room-entitlement-only shape with one canonical operator configuration model that distinguishes reusable app-scoped connections from room-scoped direct configuration while preserving exactly one room materialization path.
- [x] Let an operator define reusable app-scoped provider credentials once and attach them to many rooms without duplicating plaintext secrets or config drift.
- [x] Let a room own direct room-scoped secrets and configuration that never become globally reusable and never materialize outside that room runtime.
- [x] Keep secret handling write-only after save: masked fields in the UI, explicit replace/rotate actions, no plaintext reads back from the API, and no plaintext leakage to logs or query params.
- [x] Model provider configuration canonically enough that the operator can see which provider, model defaults, and credential source a room will use without inventing parallel execution truth.
- [x] Model MCP connections canonically enough that the operator can define transport, server identity, auth mode, allowed tools, and validation status once and then bind them to rooms explicitly.
- [x] Materialize only the room-effective configuration into the runtime so each room receives the exact providers, MCP servers, secrets, and defaults it is allowed to use.
- [x] Fail room provisioning and reconcile closed when a required secret, provider binding, model default, or MCP definition is missing or invalid.
- [x] Add audit coverage for secret creation, secret rotation, connection changes, and room-binding changes so security-sensitive actions are reconstructable.
- [ ] Add tests that exercise the real failure modes for secret creation, secret rotation, room binding, runtime materialization, and invalid effective configuration. (covered runtime startup failure, room-secret materialization, secret env-key conflict, cron run acknowledgement, provider normalization, Codex OAuth config, MCP stdio validation, and blocked effective-config runtime start; connection rotation/binding DB integration edge tests still need automated coverage)

## Phase 8 — Operator settings surfaces

- [x] Build an app-level settings surface where the operator can manage reusable provider connections, reusable MCP connections, app defaults, and audit-visible secret rotation.
- [x] Build a room-level settings surface where the operator can manage room identity, room-scoped secrets, room-bound app connections, and room-specific overrides without editing raw runtime files.
- [x] Show effective room configuration clearly: which app-scoped connections are attached, which room-scoped secrets exist, which provider/model path the room will use, and which MCP servers and tool allowances are exposed.
- [x] Keep secure inputs bounded and predictable: masked by default, explicit replace flow, strong validation feedback, and no ambiguous “saved but unknown” states.
- [x] Surface blocked or misconfigured provider and MCP state before room start or first task so the operator sees why the room cannot execute.
- [x] Keep naming and navigation consistent across the app: rooms, room brain, sessions, triggers, connections, and secrets. No leftover sandbox, engine-choice, or host-runtime language.
- [ ] Split complex settings and forms into bounded reusable modules rather than growing monolithic route files or duplicating form logic. (frontend rewrite extracted the authenticated app shell, global pages, room workspace, and route-auth helpers, and removed stale header/footer remnants; room workspace and settings still need smaller component extraction before this is fully closed)

## Phase 9 — First-run onboarding and first-room success path

- [x] Detect an incomplete first-run deployment and route the operator into onboarding instead of dropping them into a shell that cannot yet do useful work. (verified in an isolated empty-volume Docker stack: first login redirects to `/onboarding`, and `skipOnboarding=1` remains available for recovery/manual setup)
- [ ] Make onboarding walk through the actual happy path: root login, app-scoped provider setup, optional first MCP connection, first room identity/configuration, first session, first task, and success confirmation.
- [x] Ensure first-room creation includes required bindings so a room is ready to execute when it opens, not just ready to exist. (provider binding, room-scoped provider key path, MCP binding, instructions, startup, and optional cron are part of create-room)
- [ ] Validate provider connectivity, secret presence, and room readiness before allowing the operator to finish onboarding.
- [ ] Leave the operator in a populated room workspace with a selected session, a successful first task or an explicit blocked reason, and clear next actions.
- [x] Provide recovery paths for unfinished onboarding, later provider changes, later MCP additions, and adding additional rooms after the first one. (implemented through dashboard readiness, app settings, and room settings rather than a dedicated wizard)

## Phase 10 — Room workspace UX overhaul

- [x] Rework the room workspace so an operator can understand room status, effective configuration, sessions, triggers, and recent results at a glance.
- [x] Make the primary actions obvious in the room: configure the room, start or resume a session, send a task, inspect output, and manage unattended execution.
- [x] Add explicit room settings entry points instead of overloading execution-truth panels to carry all configuration meaning.
- [x] Improve activity and failure presentation so runtime problems point to the real missing provider, secret, MCP, or room-binding issue.
- [x] Expose workspace, memory, and artifact surfaces enough to prove the room-as-colleague thesis rather than leaving the room as a thin chat shell.
- [ ] Keep the UI implementation maintainable: bounded route files, shared field primitives only where they remove real duplication, and no parallel representations of the same room state. (state remains canonical and the UI now follows the room/sidebar/session model from `plan/uiux.md`; room workspace/settings are still large and need component extraction before this is complete)

## Phase 11 — Prove the finished product end to end

- [ ] Pass a full Docker end-to-end flow from empty volumes: boot the stack, recover root credentials, complete onboarding, add an app-scoped provider credential, add a room-scoped secret, add an MCP connection, create a room, send a task, observe a result, create a cron, run it, restart the stack, and verify persistence. (isolated empty-volume stack on port 3100 verified migrations, generated root recovery credentials, login, first-run onboarding redirect, dashboard recovery, settings load, and bundled OpenClaw availability. Existing main-stack room verified Codex OAuth URL generation, copy/open/redirect controls, race-safe polling, cancellation cleanup, and canonical OpenClaw runtime config. Real provider task/cron persistence still needs operator-owned OpenRouter key or completed Codex OAuth)
- [x] Verify secret safety: no plaintext secret leakage in UI payloads, logs, URLs, room runtime files outside the intended room root, or app-scoped materialization paths. (checked placeholder room secret appears only in that room runtime secret file and env file)
- [x] Verify auditability for connection creation, secret rotation, room binding, room lifecycle, and operator-triggered runtime changes. (verified audit events in Postgres for provider, MCP, room config, room secret, login, and runtime lifecycle paths)
- [ ] Rewrite the README and supporting docs around the finished product flow once the in-app path is real, not aspirational.
- [ ] Run a final copy, navigation, and product polish sweep only after the real configuration and onboarding flows are correct. (manual UIUX sweep completed for the rebuilt shell and room flows; fixed blocked-room hero copy/tone and global file-count drift. Final pass remains gated on real provider runtime verification)

## Gate

- [x] Do not add broad workflow-engine or multi-framework abstraction work before the room-first OpenClaw path includes secure config, first-run onboarding, and a daily-usable room workspace. (kept scope to the single OpenClaw room path)
