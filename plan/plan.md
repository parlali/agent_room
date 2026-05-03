# Agent Room Launch Readiness Plan

Status: implemented and verified

Last updated: 2026-05-03

## Execution Notes

Implemented and verified the launch-readiness pass in the Docker stack on 2026-05-03. Direct browser smoke used the existing OAuth-backed Test room for runtime behavior and created a new room to verify fail-closed setup when Codex OAuth is missing. Image generation tooling, settings, secret materialization, artifact storage, UI, and manual room smoke are implemented and verified with Gemini image generation. Provider token and cost fields stay explicit unknown where Pi/Codex does not expose usage; runtime duration, document worker events, and image usage are recorded and rendered.

Cleanup finding on 2026-05-03: settings now support deleting provider connections and connected tools. Deletes fail closed while rooms still reference the connection, deleting a default provider clears the app default model, stored credentials are removed, and deletion is audited without logging secret values. Search backend host, timeout, and result-count plumbing are no longer exposed in normal settings; users control Web search through the capability toggle while deployment config remains internal.

Settings follow-up on 2026-05-03: app defaults now derive the model from the selected provider connection instead of storing a second editable model override. The provider sheet default switch can also clear the app default. Main provider models and image models are selected from canonical dropdowns, and app-level image defaults now include a write-only API key that is materialized into inherited room runtime config.

Gemini image follow-up on 2026-05-03: Gemini API key/model visibility succeeds for `gemini-3.1-flash-image-preview`. The original Gemini adapter request shape timed out, while the documented REST shape with `x-goog-api-key`, image config, and Gemini 3.1 image size returned a JPEG and usage metadata. The adapter now uses that request shape. Browser-visible room smoke generated and promoted durable image artifacts, including `plan-verification-usage-recorded-image-1.jpg`.

Final artifact and usage follow-up on 2026-05-03: browser smoke generated DOCX, XLSX, PPTX, PDF, and image artifacts in the Plan verification room and verified them in the Files UI. XLSX testing exposed real agent-facing contract gaps, so the workbook tool now canonicalizes `sheets` and `data`, supports direct cell edits, preserves formulas and embedded charts, and records document/image tool usage durations through the app-side runtime event read path. The room and global Usage UI render the final run, image, and document worker records with unknown provider token/cost fields kept explicit.

Verification hardening on 2026-05-04: reviewed the staged implementation against the plan and fixed follow-up defects before treating it as complete. URL fetch now rejects embedded credentials, blocks IPv4-mapped IPv6 private addresses, and redacts URL query/fragment data before audit/tool persistence. Background command state no longer stores raw command text. Scheduled run usage records are linked back to their cron job id so job detail usage is not empty after real runs. Stale room-scoped provider/image credentials are cleaned or withheld from generic secret materialization when provider binding changes. File previews skip symlinks, read only bounded bytes, and render SVG/text data URIs correctly. Document workers now fail closed unless they can use the same sandbox identity rules as shell tools. Cron recovery treats `running_at` with missing `locked_until` as an expired lease.

## Purpose

This plan tracks the next implementation pass required before Agent Room is deployed for serious daily use.

The goal is not to add a loose set of features. The goal is to make every room behave like a functional, persistent, room-local coworker that can work with the web, ordinary office files, images, scheduled work, memory, and long-running execution without turning the codebase into layered glue.

Correctness, maintainability, isolation, auditability, credential safety, runtime/provider truth, and normal user-facing artifacts matter more than convenience.

## Current Baseline

- The app uses a per-room Pi wrapper runtime behind the Agent Room execution contract.
- Each room has its own workspace, artifact store, Pi state, runtime process, runtime token, provider materialization, MCP bindings, sessions, jobs, and hidden internal state path.
- The current implementation already supports bounded room file tools, shell, MCP stdio/HTTP tools, subagents, cron jobs, runtime health, streaming, provider validation, and audit events.
- Focused runtime tests currently pass for Pi runtime, room tools, MCP bridge, cron, runtime lifecycle, readiness, provider validation, and system prompt paths.

The baseline is useful, but not yet a complete coworker product. The gaps below must be addressed with clean modules and one source of truth per concept.

## Product Decisions

- Each room is a standalone coworker. There is no shared user-level memory.
- The system prompt should speak to the running model as the agent. It should not explain that other rooms exist or that the app isolates rooms internally.
- Memory is room-local, canonical JSON, and always rendered into a bounded two-page brief for the agent.
- Search and direct URL fetch are core built-in capabilities before deployment.
- Browser automation and Chrome MCP are later computer-use capabilities, not the first search primitive.
- SearXNG is the default no-extra-token search backend shipped with the Docker stack unless implementation proves it insufficient.
- Office formats are core product capabilities, not optional developer conveniences.
- The agent should create, edit, export, and verify PDF, DOCX, XLSX, and PPTX files through structured services.
- Images are provider-backed capabilities with explicit provider/key/model configuration.
- Token, runtime, cost, and tool telemetry must be real. Placeholder `null` usage fields are not acceptable for serious use.
- MCP limitations beyond current stdio/HTTP tool support can be refined during use, except where they block core capabilities.

## Engineering Rules For This Pass

- Do not duplicate logic.
- Do not create multiple sources of truth.
- Prefer typed canonical data structures over ad hoc strings.
- Keep provider-specific and runtime-specific semantics visible.
- Use bounded explicit fallbacks only. Log them and fail closed for safety-critical paths.
- Keep room memory, room files, provider credentials, MCP configuration, telemetry, jobs, and artifacts canonical.
- Rewrite or remove redundant code rather than layering new code over obsolete code.
- Add shared abstractions only when they remove real duplication.
- Every plan item needs direct behavior verification and downstream-effect checks before being marked complete.

## Track 0: Documentation Baseline

- [x] Replace the completed legacy `plan/plan.md` with this launch-readiness plan.
- [x] Refresh `plan/context.md` to state the refined product direction.
- [x] Refresh `plan/architecture.md` to state the runtime, memory, search, artifact, image, telemetry, and prompt architecture.
- [x] Refresh `plan/uiux.md` to state the normal-user product surface, capabilities pages, memory UI, artifact workflows, and telemetry UI.

## Track 1: Long-Running Work And Timeouts

### Intended Behavior

Agent Room must protect against hung providers, tools, and commands without preventing 8-hour autonomous work.

### Tasks

- [x] Replace fixed total-turn timeouts with an idle watchdog plus a configurable total run budget.
- [x] Add separate budgets for manual turns, scheduled turns, subagent turns, shell commands, web fetches, document workers, image generation, and MCP tools.
- [x] Default long autonomous agent runs to an 8-hour budget unless a room or job explicitly sets a smaller value.
- [x] Keep provider stream idle timeout separate from total allowed run time.
- [x] Preserve hard stop and abort behavior for manually cancelled runs.
- [x] Introduce a run heartbeat record that updates while the agent is actively streaming, calling tools, polling background work, or receiving progress from workers.
- [x] Make timeout errors identify whether the failure was idle timeout, total run budget, provider timeout, command timeout, worker timeout, or explicit abort.
- [x] Update UI states so long work shows active progress rather than appearing stuck.

### Verification

- [x] Unit tests cover idle timeout versus total run budget.
- [x] Runtime tests cover aborting a hung turn without killing a healthy long run.
- [x] Manual smoke test runs a simulated long job with periodic heartbeats and confirms no timeout until the budget expires.
- [x] Manual smoke test runs a silent hung job and confirms idle timeout cancels it.

## Track 2: Background Shell Processes

### Intended Behavior

Shell execution should support long tasks without using one blocking tool call as the entire execution model.

### Tasks

- [x] Replace the single blocking shell call path with a background command service.
- [x] Add tools to start a command, poll output, read status, and terminate by command id.
- [x] Keep cwd, environment, writable paths, output bytes, and process ownership bounded to the room workspace and room runtime user.
- [x] Store command metadata in runtime-local state with room, session, run id, command id, status, startedAt, lastOutputAt, exit code, and truncated output markers.
- [x] Stream command progress to the agent and UI without storing unbounded output in session context.
- [x] Keep short commands ergonomic by letting the agent use a single high-level tool that starts and waits up to a small timeout before returning a handle.
- [x] Add cleanup for orphaned commands on runtime shutdown and explicit room stop.

### Verification

- [x] Tests cover command start, poll, output truncation, terminate, exit code, and room path bounds.
- [x] Tests cover command cleanup on abort and runtime shutdown.
- [x] Manual smoke test runs a long command and confirms the agent can continue polling it.

## Track 3: Subagent Concurrency

### Intended Behavior

Subagents should help with parallel work without causing uncontrolled cost, thread explosion, or file contention.

### Tasks

- [x] Change default max active subagents from 2 to 5.
- [x] Add a room-level configurable subagent limit with a hard safety cap.
- [x] Record subagent parent run id, child run id, role/name, task, status, runtime, token usage, and final output.
- [x] Strengthen subagent prompt/task boundaries so child sessions know their role and expected output.
- [x] Add optional write-scope guidance when the main agent delegates coding or document work.
- [x] Keep subagents disabled from spawning nested subagents unless a later explicit design allows it.
- [x] Surface active subagents in session progress and room activity.

### Verification

- [x] Tests cover max 5 active subagents by default.
- [x] Tests cover hard cap enforcement.
- [x] Smoke test spawns five bounded subagents and confirms parent receives results without duplicate thread ownership.

## Track 4: Cron Locks, Leases, And Scheduled Runs

### Intended Behavior

Scheduled jobs should run autonomously and should not duplicate if a job takes longer than the first lock lease.

### Tasks

- [x] Replace the static 10 minute lock assumption with a dynamic renewable lease.
- [x] Compute initial lease from job interval, configured run budget, and a capped maximum stale-lock duration.
- [x] Renew the lock while the scheduled run heartbeat is fresh.
- [x] Prevent due-job claiming when `running_at` is active and the lease is fresh.
- [x] Make expired-lock recovery explicit and auditable.
- [x] Record scheduled run heartbeat, lease expiration, claimedAt, lockToken, lastRenewedAt, run budget, and reason for recovery.
- [x] Keep next run scheduling deterministic after success, failure, timeout, abort, and crash recovery.
- [x] Ensure scheduled runs use the same send path, memory brief, tools, search, capabilities, and provider materialization as manual runs.

### Verification

- [x] Tests cover short interval jobs, long interval jobs, lock renewal, expired lock recovery, and no duplicate running claim.
- [x] Tests cover scheduler restart while a job is running.
- [x] Manual smoke test runs a job longer than its initial lease and confirms no duplicate session starts.

## Track 5: Room Memory

### Intended Behavior

Each room has exactly one canonical memory source. The agent receives a concise deterministic brief every turn. Memory can be updated by the agent through typed tools and cleaned by a background maintainer.

### Canonical Format

Memory is a room-local JSON document. It is not Markdown and not split into multiple hidden memory files.

Required shape:

```ts
type RoomMemory = {
    version: 1
    identity: {
        role: string
        responsibilities: MemoryItem[]
        boundaries: MemoryItem[]
    }
    operator: {
        facts: MemoryItem[]
        preferences: MemoryItem[]
    }
    behavior: {
        rules: MemoryItem[]
        communication: MemoryItem[]
    }
    currentWork: {
        goals: MemoryItem[]
        projects: MemoryItem[]
        context: MemoryItem[]
    }
    schedule: {
        reminders: TimedMemoryItem[]
        deadlines: TimedMemoryItem[]
        recurring: TimedMemoryItem[]
    }
    decisions: MemoryItem[]
    doNotForget: MemoryItem[]
}
```

Each item has an id, text, createdAt, optional updatedAt, optional source, optional priority, and optional tags. Timed items also support dueAt, expiresAt, completedAt, and recurrence metadata.

Current datetime is injected by runtime context. It is not stored as memory.

### Tasks

- [x] Replace hidden memory Markdown with canonical `memory.json` under the room state boundary.
- [x] Decide whether existing `plan`, `tasks`, and `decisions` internal docs become transient run ledger state, migrate into `memory.json`, or are removed.
- [x] Add a strict schema validator and migration function for `memory.json`.
- [x] Add a deterministic two-page memory brief renderer used by the system prompt builder.
- [x] Add memory tools for read, replace, and typed patch operations.
- [x] Add optimistic concurrency with expected revision/hash for memory updates.
- [x] Add a background memory maintainer that cleans expired entries, marks stale reminders, trims low-priority items, normalizes timestamps, and keeps memory inside the cap.
- [x] Add a room memory UI that shows the JSON-backed sections in normal language and allows direct edits.
- [x] Ensure memory updates are audited without logging sensitive content unnecessarily.
- [x] Make memory maintenance room-local and never cross-room.

### Verification

- [x] Tests cover schema validation, migration, rendering, cap enforcement, typed patching, and stale timestamp cleanup.
- [x] Tests cover concurrency conflict handling.
- [x] Manual smoke test stores a user preference, starts a new session, and confirms the agent uses it from the rendered memory brief.
- [x] Manual smoke test adds an expired reminder and confirms the background maintainer cleans or marks it.

## Track 6: Built-In Web Search And Fetch

### Intended Behavior

Every capable room can search the web and fetch known URLs without requiring a paid third-party search key. Browser automation is deferred.

### Backend Decision

SearXNG is the default bundled search backend in the Docker stack. Agent Room owns a typed search client and search tools over it. Provider-native search can be added later as an optimization or provider-specific path, but it is not the first source of truth.

### Tasks

- [x] Add SearXNG to Docker Compose as an internal service.
- [x] Add app configuration for search backend URL, enabled state, default result count, and timeout.
- [x] Add a typed server-side SearXNG client with bounded response parsing.
- [x] Add `agent_room_web_search` tool with query, result count, language, freshness hint, safe search hint, allowed domains, blocked domains, and optional location fields.
- [x] Return structured results with title, URL, snippet, source engine when available, fetchedAt, and rank.
- [x] Add `agent_room_fetch_url` for direct URL fetching.
- [x] Implement SSRF protections for fetch: block localhost, private IP ranges, link-local ranges, metadata endpoints, non-http protocols, excessive redirects, oversized bodies, and dangerous content types.
- [x] Add output caps, timeout caps, content-type handling, and text extraction.
- [x] Record search/fetch audit events with query, URL, result count, byte count, and status without storing secrets.
- [x] Add search/fetch result rendering in chat progress and tool details.
- [x] Update the system prompt to expect search for current-world facts, docs lookup, prices, laws, provider details, and time-sensitive facts.

### Verification

- [x] Unit tests cover search response parsing.
- [x] Unit tests cover URL allow/deny rules and SSRF protections.
- [x] Integration test runs against the bundled SearXNG service in Docker.
- [x] Manual smoke test asks a room for current web research and verifies cited results.
- [x] Manual smoke test fetches a known URL and rejects a local/private URL.

## Track 7: Office, PDF, And Normal File Artifacts

### Intended Behavior

The agent should work in normal user-facing formats by default. Markdown and JSON can exist internally, but final deliverables should be PDF, DOCX, XLSX, PPTX, images, or other ordinary artifacts when the request implies real-world work.

### Architecture

Create an Agent Room document capability layer with structured services and worker boundaries. Do not make the main agent hand-edit opaque binary files or zipped XML by prompt alone.

### Tasks

- [x] Add a document capability module with typed service interfaces for DOCX, XLSX, PPTX, and PDF.
- [x] Install required Docker dependencies for Office import/export and render verification, including LibreOffice or an equivalent headless renderer.
- [x] Add DOCX create, inspect, edit, and export support through structured document operations.
- [x] Add XLSX create, inspect, edit, formula, table, chart, and export support through structured workbook operations.
- [x] Add PPTX create, inspect, edit, slide, layout, chart, image, and export support through structured presentation operations.
- [x] Add PDF creation/export support from documents, sheets, presentations, and structured HTML where appropriate.
- [x] Add preview rendering so generated documents can be converted to PDF or PNG pages for verification.
- [x] Add artifact promotion for generated Office/PDF files into the room durable store.
- [x] Add tools that expose high-level operations to the agent rather than raw low-level file mutation.
- [x] Allow implementation to regenerate a document internally when that is safer than patching, while preserving the product behavior of editing the requested document.
- [x] Add file provenance so users can see which session/job created or edited each artifact.

### Verification

- [x] Tests cover create/edit/export for DOCX, XLSX, PPTX, and PDF paths.
- [x] Tests cover unsupported or malformed input files failing with clear errors.
- [x] Render verification runs for representative outputs.
- [x] Manual smoke test creates a Word document, edits it, exports PDF, and previews it.
- [x] Manual smoke test creates and edits an Excel workbook with formulas.
- [x] Manual smoke test creates and edits a PowerPoint deck with rendered preview.

## Track 8: Image Capability

### Intended Behavior

Rooms can generate images through explicit configured providers. Image capability is default product functionality, but provider keys and models are configured by the operator.

### Tasks

- [x] Add image capability configuration to app settings and room settings.
- [x] Support at least OpenAI Images and Gemini/Nano Banana as provider options.
- [x] Store image provider credentials through existing encrypted secret infrastructure.
- [x] Add typed image generation service with prompt, size/aspect ratio, quality, count, model, and safety/provider metadata.
- [x] Add image artifact storage and provenance.
- [x] Add agent tool for image generation.
- [x] Add UI for generated images in chat and files.
- [x] Add telemetry for image requests, provider, model, latency, and estimated cost.

### Verification

- [x] Tests cover provider config validation and secret materialization.
- [x] Tests cover generated image artifact indexing.
- [x] Manual smoke test generates an image and confirms it appears as a durable room artifact. (verified with Gemini image generation; `plan-verification-usage-recorded-image-1.jpg` appears in the room Files UI)

## Track 9: Capabilities Configuration

### Intended Behavior

Capabilities are first-class product features that ship enabled by default where safe. The UI lets an operator see, configure, and disable capabilities without turning them into an unbounded plugin system.

### Tasks

- [x] Add a capabilities model for Web Search, URL Fetch, Documents, Spreadsheets, Presentations, PDF, Images, MCP, and Shell/Coding.
- [x] Expose app-level capability defaults and room-level overrides.
- [x] Keep capability config typed and canonical.
- [x] Make capability availability visible in room status and settings.
- [x] Update prompt builder to include enabled capabilities and correct usage expectations.
- [x] Ensure disabled capabilities do not register their tools.

### Verification

- [x] Tests cover app defaults, room overrides, disabled tool removal, and prompt capability rendering.
- [x] UI smoke test toggles a capability and confirms the room tool list changes after reconcile.

## Track 10: Telemetry, Usage, And Cost

### Intended Behavior

Usage fields must be real. Operators should understand runtime, token, tool, job, model, provider, and estimated cost behavior per room.

### Tasks

- [x] Add canonical DB tables for room run usage, provider usage, tool usage, document worker usage, image usage, and job usage.
- [x] Capture input, output, cached, reasoning, and total tokens where provider/Pi exposes them.
- [x] Capture run duration, active duration, idle duration, tool duration, and worker duration.
- [x] Add model price catalog with provider-specific cost semantics.
- [x] Estimate cost per turn, session, job run, room, provider, and date range.
- [x] Keep unknown usage explicit rather than inventing values.
- [x] Update room snapshot fields so `runtimeMs`, `totalTokens`, and `estimatedCostUsd` are populated where possible.
- [x] Add UI for room usage, global usage, job usage, and provider/model usage trends.
- [x] Add export path for local usage data.
- [x] Keep optional OpenTelemetry export out of the first pass unless local UI tracking is complete.

### Verification

- [x] Tests cover usage aggregation and price calculation.
- [x] Tests cover unknown provider usage staying explicit.
- [x] Manual smoke test runs a chat, tool call, scheduled job, document generation, and image generation, then verifies UI usage. (verified in room and global Usage UI; image and document worker rows render with explicit unknown token/cost fields where provider usage is unavailable)

## Track 11: Pi System Prompt And Harness

### Intended Behavior

The system prompt and runtime harness should make the model act like the agent for this workspace. It should not explain Agent Room internals or multi-room isolation to the model.

### Prompt Principles

- Tell the model who it is and what kind of work it owns.
- Do not tell it that other rooms exist.
- Do not make implementation isolation part of the model's mental model.
- Be explicit about planning, execution, verification, memory, search, file artifacts, scheduled work, and communication.
- Prefer normal user-facing deliverables over developer-only scratch files.
- Keep credential and secret handling rules concrete and short.

### Tasks

- [x] Rewrite `buildAgentRoomSystemPrompt` around an agent work contract rather than runtime implementation exposition.
- [x] Include current date/time and timezone explicitly.
- [x] Include rendered room memory brief.
- [x] Include active run context: manual message, scheduled run, subagent run, or background maintenance run.
- [x] Include enabled capabilities with usage expectations.
- [x] Define the default work loop: understand, inspect, plan when non-trivial, execute, verify, update memory if needed, produce result.
- [x] Define when to search the web.
- [x] Define when to produce PDF, DOCX, XLSX, PPTX, images, or other durable artifacts.
- [x] Define scheduled-run behavior as autonomous and result-producing.
- [x] Define memory update behavior through typed memory tools.
- [x] Define final response expectations: concise, artifact-aware, honest about verification.
- [x] Update tool descriptions to match product semantics instead of internal implementation names where possible.
- [x] Add tests that assert the prompt does not mention other rooms, runtime ports, bearer tokens, or internal isolation mechanics.

### Verification

- [x] Snapshot tests cover prompt sections for basic room, memory-enabled room, scheduled job, web capability, document capability, and disabled capabilities.
- [x] Manual smoke test asks for a multi-step task and verifies the agent plans, searches, executes, creates artifacts when appropriate, and updates memory only when durable.

## Track 12: MCP Refinement

### Intended Behavior

Current MCP support remains useful, but it should not block deployment unless a core capability depends on it.

### Tasks

- [x] Keep current stdio and HTTP/streamable HTTP MCP support stable.
- [x] Add clearer room status when an MCP server fails to initialize.
- [x] Defer MCP OAuth, marketplace/catalogue, resources, prompts, and connector-specific UX until core web, memory, artifacts, telemetry, and long-running work are stable.
- [x] Record future MCP gaps in a separate follow-up plan after deployment.

### Verification

- [x] Existing MCP bridge tests remain passing.
- [x] Manual smoke test binds a simple MCP server and confirms tools appear only in that room.

## Track 13: UI Updates

### Intended Behavior

The UI should present Agent Room as a normal coworker portal. It should not expose runtime machinery by default.

### Tasks

- [x] Add room memory UI backed by canonical JSON sections.
- [x] Add capabilities settings for web, fetch, office, PDF, images, MCP, and shell/coding.
- [x] Update room status to show capability readiness and one clear fix per blocker.
- [x] Update files UI to prioritize normal artifacts, previews, provenance, and download/open actions.
- [x] Add artifact previews for Office/PDF/images.
- [x] Add usage and cost pages at app and room level.
- [x] Add job run detail view with prompt, status, output artifacts, usage, duration, and error.
- [x] Keep technical details behind scoped disclosures.

### Verification

- [x] Browser smoke tests cover memory, capabilities, files, jobs, status, and usage pages.
- [x] Mobile smoke test covers same primary flows.

## Track 14: End-To-End Deployment Gate

### Intended Behavior

Before deployment, Agent Room should prove the core coworker loop in the Docker stack.

### Tasks

- [x] Build the Docker stack from scratch.
- [x] Configure a model provider.
- [x] Create a room.
- [x] Confirm memory brief is injected and editable.
- [x] Run a web search task with citations.
- [x] Fetch a direct URL safely.
- [x] Generate and edit DOCX, XLSX, PPTX, PDF, and image artifacts. (verified in Docker and browser; final XLSX edit preserved formulas and chart XML, and Gemini image output appears as a durable artifact)
- [x] Run a scheduled autonomous job.
- [x] Run a simulated long task with heartbeat.
- [x] Spawn five subagents.
- [x] Confirm telemetry renders in UI.
- [x] Confirm secrets do not leak to browser payloads, logs, files, or tool output.
- [x] Confirm room state remains under the room root.

### Verification

- [x] `bun run typecheck`
- [x] `bun run lint`
- [x] `bun run test`
- [x] Docker build from current checkout (rebuilt app image and running stack with this diff)
- [x] Manual browser smoke test
- [x] Runtime state and log scan for credential leakage

## Deferred Until After First Deployment

- Chrome MCP and full browser automation.
- MCP OAuth and public connector marketplace.
- Video generation.
- Voice generation and transcription.
- External channel triggers such as Slack, email, Telegram, and inbound webhooks.
- Optional OpenTelemetry export.
- OSS release docs and public security pass.

## Completion Criteria

This plan is complete when:

- Long-running work can run for hours without being mistaken for a hang.
- Hung work is still cancelled by explicit idle watchdogs.
- Scheduled jobs do not duplicate because of expired static locks.
- Each room has a single canonical JSON memory and a two-page rendered brief.
- Built-in search and URL fetch work in Docker without another paid search key.
- Office/PDF/image artifacts can be created, edited, exported, previewed, and stored durably.
- Telemetry fields are populated and rendered in useful UI.
- The Pi prompt behaves like a coworker harness and does not expose room-isolation implementation details to the model.
- The codebase remains typed, clean, and free of duplicate sources of truth.
