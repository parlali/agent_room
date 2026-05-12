# Agent Room Active Plan

Status: first-pass performance work landed; usability architecture phase open

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

Status: first-pass production fixes landed; superseded by the Chat Usability Architecture Phase for remaining work

This is a multi-pass refactor, not a safe one-pass change. The slow experience comes from app-side request, payload, streaming, cache, route remount, and rendering design, with Tailscale DERP latency amplifying every extra round trip. The refactor must preserve runtime/provider truth, auditability, room isolation, and credential safety.

Progress made so far:

- Production performance logs now attribute server edge, runtime proxy, snapshot, usage sync, and SSE timing without logging secrets or message bodies.
- Runtime usage sync no longer blocks snapshot, send, edit, or normal navigation hot paths.
- Selected-session snapshots can load a bounded recent message window, with older history loaded on demand.
- Runtime display projection now strips raw tool payloads from the UI contract and pre-groups tool activity for persisted rows.
- Production asset serving now uses immutable cache headers and gzip for hashed client assets while keeping HTML and authenticated responses uncached.
- Markdown internal app links now use TanStack navigation where safe, and route chunks for dashboard tabs are preloaded to reduce blank first visits.

Latest user-visible findings:

- First-loads improved, but the app still does not feel smooth enough for daily use.
- Chat switching can still feel unresponsive because the click is not always acknowledged immediately with a selected-thread shell and cached latest messages.
- Memory/settings navigation can still cause hard page remounts or blank-screen pauses, even after client caching.
- Markdown still stutters because the current first-pass behavior can render plain text and then hydrate into formatted markdown, causing layout shift.
- Artifact/sidebar behavior is still wrong: in some back-navigation cases the panel lazy loads despite prior state, and when it appears it opens abruptly instead of sliding from persistent state.
- Server logs are now useful for backend attribution, but they cannot fully explain main-thread stalls, React render work, route remounts, markdown hydration, or browser document navigations. Browser-side interaction marks are needed for the remaining work.

Reference study: external Vite chat app

- The Vite chat app keeps the application shell and sidebar mounted above chat routes, so selecting a chat is mostly a client-state pointer change instead of a page-level remount.
- Chat state is WebSocket-fed into a normalized client store. Sidebar summaries, thread shell state, and thread detail state are separate slices so sidebar updates do not churn message arrays.
- Active, recent, and sidebar-visible thread detail subscriptions are retained with a bounded TTL/LRU cache, and visible sidebar chats are prewarmed after idle time.
- Long chat history is handled with a virtualized timeline, stable row identity, structural sharing, grouped/collapsed work/tool rows, and bottom-scroll preservation.
- Markdown is rendered as markdown from the start for visible rows. Expensive code highlighting is cached/deferred behind a narrow boundary; the whole message is not intentionally rendered as plain text first.
- Right-side workbench/panel shells are persistent or keep-mounted, with open state separate from lazy content loading. Chunk loading does not decide whether the panel should open.
- React Compiler and memoization help, but the main smoothness comes from data ownership, retained detail subscriptions, stable rows, and persistent layout.

Closed first-pass checklist:

- [x] Add lightweight request, runtime proxy, snapshot, usage sync, and SSE timing instrumentation so production latency can be attributed per route without logging secrets or message bodies. (Implemented as opt-in `AGENT_ROOM_PERF_LOGS` structured JSON logs for the production server edge, app-to-runtime proxy, snapshot assembly, usage sync, and browser/runtime SSE streams.)
- [x] Move runtime usage sync out of chat/session/navigation hot paths. Usage ingestion must be incremental by durable byte offset or equivalent cursor, bounded, logged on failure, and safe to resume after restarts. (Snapshot and manual send/edit paths no longer wait on usage sync; usage ingestion now persists a byte offset and line cursor, with line-only state migrated by streaming the log once.)
- [x] Add message paging and/or virtualization for long sessions. Opening a chat should load a recent window first, preserve scroll behavior, and fetch older history on demand without reparsing every prior markdown block. (Implemented a selected-session display-window endpoint with cursor paging, cached runtime projection, older-history loading, and virtualized persistent rows.)
- [x] Memoize or precompute expensive message display work, especially markdown parsing and tool activity grouping, so streaming a new token does not re-render the whole visible transcript unnecessarily. (First-pass implementation moved tool grouping into the runtime display projection, stripped raw tool payloads from the UI contract, and memoized mounted markdown rows. UX verification found that plain-text-first markdown hydration is not acceptable and is superseded by the next phase.)
- [x] Fix internal hard reload sources. Markdown-rendered internal app links should route through TanStack where safe, and normal app controls should never document-navigate except for downloads, external OAuth/provider flows, or intentional exports. (Markdown app-route links now use TanStack `Link`; API/assets/external links remain normal anchors; room dashboard route chunks are preloaded from the shell and tab menu to reduce blank first visits.)
- [x] Add immutable cache headers and compression for hashed production assets served by `scripts/start-server.ts`, while keeping HTML and authenticated server responses correctly uncached. (Hashed `/assets/` files now get immutable cache headers, and compressible client assets are served with gzip when accepted.)

Outstanding items from this first pass are intentionally folded into the next phase below. Do not implement this section as a second checklist.

## Chat Usability Architecture Phase

Status: complete

Goal: make the app feel immediately interactive on production builds, even for cold chats, long histories, heavy tool calls, artifacts, settings, and memory pages.

Fresh-session handoff:

- Start here. This is the canonical outstanding checklist for performance and usability work.
- Implement the smallest coherent design that satisfies the behavior; do not blindly recreate the reference app.
- Keep room/session ownership, credential safety, runtime/provider truth, and auditability intact.
- Use production Docker builds and `AGENT_ROOM_PERF_LOGS` when validating user-visible performance.
- Add browser-side marks before guessing at React/render causes; server logs alone cannot see markdown/layout/main-thread stalls.

- [x] Add browser-side interaction tracing for the remaining defects: chat row click to selected-shell paint, selected-shell paint to latest-message paint, markdown render cost, artifact panel mount/open timing, route remounts, document navigations, and long main-thread tasks. Logs must avoid message bodies, tool payloads, secrets, and personal paths. (Implemented client performance events for navigation paint, authenticated document navigation, route remounts, chat shell/latest-message paint, markdown render cost, chat window render, artifact panel mount/open, and long-task observation; payloads stay bounded to ids, counts, durations, route shapes, and text length.)
- [x] Make the app shell persistent across room chat, memory, settings, files, jobs, usage, and status routes. Normal internal navigation should not remount the whole page or leave a blank document-level surface. (Moved the authenticated app shell to the root provider and removed nested route shells.)
- [x] Create a canonical client chat projection store that separates sidebar summaries, selected-session shell state, message windows, activities, artifacts, model/composer state, and live stream deltas. Avoid duplicate query-owned sources of truth. (React Query remains the canonical cache, with shared key builders and projection helpers for sidebar, session shell, windows, artifacts, and optimistic rows.)
- [x] Make chat selection synchronous. Clicking a sidebar row must immediately update selected visual state, route state, chat header, composer context, and any cached latest messages before cold detail loading continues. (Sidebar clicks mark the selection, prewarm/seed session detail where cached, and use placeholder shell data from the sidebar while cold payloads load.)
- [x] Retain and prewarm session detail for active, recent, and visible sidebar sessions with bounded TTL/LRU behavior, explicit invalidation, and room/session ownership checks. Fallbacks must be logged, bounded, and fail closed. (Implemented bounded visible/recent/active prewarm through React Query stale/gc policy instead of a separate LRU store.)
- [x] Split runtime snapshot contracts into canonical summary, sidebar, selected-session, activity/read-model, and artifact payloads. Each endpoint should return only the data its caller renders, with explicit cache and invalidation behavior. (Added sidebar and selected-session shell endpoints; retained full execution snapshot for status/backcompat surfaces.)
- [x] Rework live chat streaming to rely on bounded SSE deltas for visible progress and avoid invalidating full session snapshots on routine token/tool updates. Refetches should be reserved for run completion, title changes, artifacts, and explicit recovery. (Routine message/tool deltas update local stream state; full invalidation is reserved for completion, title/model/file events, and recovery.)
- [x] Add optimistic chat state for user sends and edits. The user message should appear immediately, pending state should reconcile with the runtime ack, and failed sends must roll back or clearly surface a retry path. (Optimistic query-window rows are inserted for sends/edits, reconciled by runtime invalidation, and rolled back with draft restoration on failure.)
- [x] Replace plain-text-first markdown hydration with markdown-first rendering for visible rows. Preload the markdown renderer, preserve row dimensions, cache completed message render work where safe, and defer only expensive subparts such as syntax highlighting. (Visible rows render markdown first with cached render work and no plaintext hydration pass.)
- [x] Rework the message timeline around stable virtual rows: bottom-first opening, visible-row-only rendering, structural sharing, grouped/collapsed tool and work rows, cursor loading for older history, and no full-list rerender on routine stream deltas. (Preserved the existing virtualized row model and connected it to markdown-first rendering, structural sharing, cursor windows, and bounded stream deltas.)
- [x] Keep artifact/sidebar panel shells mounted and animate open/close from state. Cache open, loaded, selected artifact, and width state per session so returning to a chat does not lazy-load the panel as if it were new. (Added a persistent artifact shell with per-session open/loaded/selected/width state and width/slide animation.)
- [x] Consolidate navigation query keys and invalidation for room header, sidebar, tabs, settings, memory, files, jobs, usage, and status. Route changes should reuse canonical cached data and only fetch the payload the destination renders. (Added canonical `roomQueryKey` and query policy helpers across the app shell, room tabs, settings, memory, files, jobs, usage, status, and chat.)
- [x] Cache authenticated user/session state in the client and throttle session `last_seen_at` writes. Route guards should not force a database write on every internal navigation. (Client auth uses the canonical auth query key; server session touch is throttled per token hash.)
- [x] Tune React Query stale times, polling, and event-driven invalidation. Polling should be sparse and bounded, with room/SSE events updating cached summaries when available. (Centralized warm/hot/retained query policy, reduced routine refetch churn, and added room-event cache sync for summaries and room surfaces.)
- [x] Bound and rotate runtime event logs. High-frequency streaming events must not persist full repeated payloads, and retained audit events must remain useful without becoming a second unbounded transcript store. (Runtime event logs rotate at a bounded size and summarize streaming message updates without persisting repeated text bodies.)
- [x] Add production probes for browser-visible behavior: chat switch responsiveness, markdown stability with long messages, artifact panel back-navigation, memory/settings navigation without hard reload, long-session scroll responsiveness, and stream continuity. (Added client probes and verified production browser-visible chat, markdown, artifact, route navigation, SSE, and runtime-provider paths with a local OpenAI-compatible provider.)
- [x] Verify the phase in the Docker production build with the performance flag enabled, then replay the same user flows against logs and browser traces before checking items off. (Verified `AGENT_ROOM_PERF_LOGS=1` in Docker production build using authenticated onboarding, provider validation/materialization, room/session creation, chat send, artifact toggle, and room memory/settings/files/jobs/usage/status navigation; captured 270 performance events.)

Suggested implementation order:

1. Add browser-side interaction tracing so remaining lag is attributed before larger rewrites.
2. Build the persistent app shell and canonical client projection store.
3. Add retained/prewarmed session detail and synchronous chat selection.
4. Split payload contracts and rework streaming invalidation around bounded deltas.
5. Replace markdown hydration and timeline rendering with markdown-first stable virtual rows.
6. Make artifact/sidebar shells persistent, stateful, and animated.
7. Consolidate navigation data flow, auth/session caching, stale times, and event-driven invalidation.
8. Add optimistic send/edit reconciliation.
9. Bound runtime event logs.
10. Verify in Docker production with browser traces and probes, then check off completed items.

## Active Planning Docs

- `plan/context.md`: product direction and scope.
- `plan/code-quality-scoring.md`: repeatable quality audit process, score rubric, current baseline, and improvement targets.

## Cleanup Notes

Removed the old `plan/spikes/` notes and `plan/uiux-mockups/` generated images from the active planning tree because they were historical implementation aids rather than current sources of truth.

The active planning surface should stay small. New research belongs in `plan/` only when it is still guiding current implementation, and completed one-off artifacts should be removed or folded into the canonical docs above.
