# Agent Room Active Plan

Status: structure-first code quality refinement captured

Last updated: 2026-05-12

## Current Work

- [x] Inspect the current planning surface and identify superseded artifacts.
- [x] Remove completed one-off spike notes and generated UI mockup images from active `plan/`.
- [x] Run structural quality probes against the current codebase.
- [x] Capture a repeatable code quality scoring process.
- [x] Record the current code quality score and the main follow-up risks.
- [x] Reduce the initial spaghetti score by splitting oversized runtime, route, GitHub, room-tool, and cron-test modules.
- [x] Verify the refactor with `bun run typecheck`, targeted Vitest suites, formatting, and the local quality score script.
- [x] Reduce the second-pass spaghetti score by splitting runtime run lifecycle, model state, title generation, file preview storage, and shared client-safe contracts. (Also corrected scoring false positives for trailing newlines and TanStack route server-function API imports.)
- [x] Continue structure-first refinement by separating web search/fetch safety, provider versus MCP connection validation, and XLSX chart packaging from their caller-facing modules.
- [x] Complete the listed spaghetti-reduction pass by splitting room/app configuration workflows, memory, image tooling, status UI, and session chat display modules. (Also removed the remaining hard line-count cap from the score; file size remains a diagnostic signal.)

## Performance Refactor Track

Status: production first-load fixes in progress

This is a multi-pass refactor, not a safe one-pass change. The slow experience appears to come from app-side request, payload, streaming, cache, and rendering design, with Tailscale DERP latency amplifying every extra round trip. The refactor should preserve runtime/provider truth, auditability, room isolation, and credential safety.

- [x] Add lightweight request, runtime proxy, snapshot, usage sync, and SSE timing instrumentation so production latency can be attributed per route without logging secrets or message bodies. (Implemented as opt-in `AGENT_ROOM_PERF_LOGS` structured JSON logs for the production server edge, app-to-runtime proxy, snapshot assembly, usage sync, and browser/runtime SSE streams.)
- [x] Move runtime usage sync out of chat/session/navigation hot paths. Usage ingestion must be incremental by durable byte offset or equivalent cursor, bounded, logged on failure, and safe to resume after restarts. (Snapshot and manual send/edit paths no longer wait on usage sync; usage ingestion now persists a byte offset and line cursor, with line-only state migrated by streaming the log once.)
- [ ] Bound and rotate runtime event logs. High-frequency streaming events must not persist full repeated payloads, and retained audit events must remain useful without becoming a second unbounded transcript store.
- [ ] Split runtime snapshot contracts into canonical summary, sidebar, selected-session, and activity/read-model payloads. Each endpoint should return only the data its caller renders, with explicit cache and invalidation behavior. (Started by allowing caller-requested zero-message summaries for overview/sidebar/status and a bounded recent message window for chat; dedicated payload contracts still remain.)
- [ ] Add optimistic chat state for user sends and edits. The user message should appear immediately, pending state should reconcile with the runtime ack, and failed sends must roll back or clearly surface a retry path.
- [ ] Rework live chat streaming to rely on bounded SSE deltas for visible progress and avoid invalidating full session snapshots on routine token/tool updates. Refetches should be reserved for run completion, title changes, artifacts, and explicit recovery.
- [x] Add message paging and/or virtualization for long sessions. Opening a chat should load a recent window first, preserve scroll behavior, and fetch older history on demand without reparsing every prior markdown block. (Implemented a selected-session display-window endpoint with cursor paging, cached runtime projection, older-history loading, and virtualized persistent rows.)
- [x] Memoize or precompute expensive message display work, especially markdown parsing and tool activity grouping, so streaming a new token does not re-render the whole visible transcript unnecessarily. (Tool grouping now happens in the runtime display projection for persisted rows, raw tool payloads are stripped from the UI contract, mounted markdown rows memoize rendered output, and chat switches now render plain text first while markdown hydrates incrementally through an idle queue.)
- [ ] Consolidate navigation data flow. Sidebar, room header, tabs, settings, status, jobs, files, and usage pages should share canonical query keys and avoid duplicate room/runtime/config requests on the same navigation.
- [ ] Cache authenticated user/session state in the client and throttle session `last_seen_at` writes. Route guards should not force a database write on every internal navigation.
- [ ] Tune React Query stale times, polling, and event-driven invalidation. Polling should be sparse and bounded, with room/SSE events updating cached summaries when available.
- [x] Fix internal hard reload sources. Markdown-rendered internal app links should route through TanStack where safe, and normal app controls should never document-navigate except for downloads, external OAuth/provider flows, or intentional exports. (Markdown app-route links now use TanStack `Link`; API/assets/external links remain normal anchors; room dashboard route chunks are preloaded from the shell and tab menu to reduce blank first visits.)
- [x] Add immutable cache headers and compression for hashed production assets served by `scripts/start-server.ts`, while keeping HTML and authenticated server responses correctly uncached. (Hashed `/assets/` files now get immutable cache headers, and compressible client assets are served with gzip when accepted.)
- [ ] Add production-like regression tests or probes for the real failure modes: chat send-to-visible latency, stream continuity, long-session open time, internal navigation without full reload, and snapshot/usage-sync behavior with a large runtime event log.
- [ ] Verify direct and downstream effects before checking items off: Docker production route timings, browser-visible navigation, chat streaming, long transcript responsiveness, usage totals, audit/event retention, and room isolation.

Suggested implementation order:

1. Instrument first, then remove usage sync from hot paths and bound runtime event logs.
2. Reduce payload shape and invalidation churn before changing larger UI state.
3. Add optimistic chat state and streaming reconciliation.
4. Add long-session rendering improvements.
5. Finish delivery/cache behavior and regression probes.

## Active Planning Docs

- `plan/context.md`: product direction and scope.
- `plan/architecture.md`: canonical runtime, isolation, and data-flow architecture.
- `plan/uiux.md`: current user-facing product surface and interaction direction.
- `plan/code-quality-scoring.md`: repeatable quality audit process, score rubric, current baseline, and improvement targets.

## Cleanup Notes

Removed the old `plan/spikes/` notes and `plan/uiux-mockups/` generated images from the active planning tree because they were historical implementation aids rather than current sources of truth.

The active planning surface should stay small. New research belongs in `plan/` only when it is still guiding current implementation, and completed one-off artifacts should be removed or folded into the canonical docs above.
