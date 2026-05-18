# Plan: docs, search, and browser automation work streams

## Status

The brainstorm has been split into three public OSS work-stream issues. Implementation now lives in the issues.

## Filed issues

- [x] Issue 1: [Docs reliability — native PDF input and office doc hardening](https://github.com/parlali/agent_room/issues/1)
- [x] Issue 2: [Search reliability — SearXNG hardening, Brave, and Browserbase search](https://github.com/parlali/agent_room/issues/2)
- [x] Issue 3: [Browser automation — interaction tools and live session UI](https://github.com/parlali/agent_room/issues/3)
- [x] Issue 8: [Runtime tools and per-room sandbox isolation](https://github.com/parlali/agent_room/issues/8)

## Filing tasks

- [x] Add `.github/ISSUE_TEMPLATE/plan_work_stream.yml` for plan-derived streams.
- [x] File Issue 1 (Docs reliability) using the template.
- [x] File Issue 2 (Search reliability) using the template.
- [x] File Issue 3 (Browser automation) using the template.
- [x] Replace this document with a short pointer to the three filed issues once they are created.

## Issue 1 implementation notes

- [x] Preserve uploaded PDFs as canonical room-local artifacts and materialize reads from that original file.
- [x] Add `read_pdf` with native Anthropic document routing and rendered page-image routing for other vision-capable models. (Originally shipped as `agent_room_read_pdf`; Issue 8 renamed model-facing runtime tools to product-neutral names.)
- [x] Remove PDF text extraction from the model-facing tool surface so `read_pdf` is the canonical PDF read path.
- [x] Persist and audit PDF ingestion mode as `native_document`, `image_render`, or `unsupported`.
- [x] Surface PDF ingestion mode in prompt attachment metadata, audit events, tool details, and model-visible attachment summaries.
- [x] Map Anthropic PDF payloads through Pi provider routing without claiming image-rendered or text-extracted content is native.
- [x] Ship repo-owned `docx`, `xlsx`, and `pptx` skills with bundled scripts for create, inspect, and edit workflows. (Updated from the original single `office-documents` wording after upstream review showed Claude/OpenAI use format-specific skills.)
- [x] Package bundled skills into the production build so runtime resource loading resolves the shipped `SKILL.md` and script.
- [x] Remove dedicated DOCX/XLSX/PPTX runtime tools so the bundled skill and script are the single create, inspect, and edit implementation.
- [x] Verify active model changes drive PDF routing, page-range reporting is truthful, and non-contiguous rendered pages stay bounded to selected pages.
- [x] Verify direct behavior and downstream effects with `bun run check`.

## Issue 2 implementation notes

- [x] Issue 2 search implementation keeps one model-facing `web_search` tool and routes Brave, Browserbase Search API, then SearXNG behind typed provider contracts. (Originally shipped as `agent_room_web_search`; Issue 8 renamed model-facing runtime tools to product-neutral names.)
- [x] Browserbase search uses the documented `POST /v1/search` API with `x-bb-api-key`, not Browserbase browser sessions, CDP, or rendered Brave Search scraping.
- [x] SearXNG engine health records rate-limited and CAPTCHA-blocked engines with short TTL and sends those engines as disabled on later SearXNG requests where supported.
- [x] PR review hardening removes provider response bodies from model-visible search failure metadata and rolls back search credential writes on rejected settings saves.
- [x] Follow-up hardening bounds provider response body reads after headers arrive, including Brave JSON, SearXNG JSON/HTML, Browserbase Search JSON, and provider error bodies.
- [x] Search implementation is split into shared contracts/helpers, SearXNG, Brave, Browserbase, and router modules so provider parsing and routing state each have focused ownership.

## Issue 3 implementation notes

- [x] Add Browserbase-backed room browser tools for open, close, navigate, click, type, scroll, screenshot, and read-text actions.
- [x] Keep Browserbase browser sessions scoped to chat sessions inside each room, replace only an existing browser for the same chat session, and close idle/runtime-shutdown sessions through Browserbase `REQUEST_RELEASE`. (Updated from the original room-level wording after review clarified concurrent same-room sessions must not interfere.)
- [x] Register browser tools only when the room has Browserbase configured and the materialized Browserbase API key is present.
- [x] Add a per-room browser action budget that materializes into the Pi runtime and fails closed when exhausted.
- [x] Surface the active browser session through the runtime snapshot and chat view live panel without logging Browserbase `connectUrl` or live inspector URLs in audit events.
- [x] Audit browser actions with bounded, sanitized payloads and keep typed runtime, snapshot, settings, and persisted config contracts canonical.
- [x] PR review hardening redacts transient CDP connection URLs, lets close release sessions after action-budget exhaustion, audits validation and automatic release paths, and splits Browserbase API, CDP, page actions, tool registration, utilities, and lifecycle management into focused modules.
- [x] Expand Browserbase automation tests to cover each action tool, auth/quota failures, invalid-input audit paths, replacement/runtime/idle release audit events, close-after-budget-exhaustion, and connect-failure redaction.
- [x] Follow-up PR review hardening aligns direct REST session creation with the Browserbase REST `browserSettings.timeout` shape, bounds the CDP WebSocket handshake, and retries automatic release after transient Browserbase release failures.
- [x] Follow-up cleanup hardening retries created-but-not-active sessions after open failure and performs immediate bounded runtime-shutdown release retries before SIGTERM cleanup continues.
- [x] Follow-up session-boundary hardening stores active Browserbase sessions, snapshots, idle timers, heartbeat timers, and retry timers by chat session key so separate same-room sessions can open, use, and clean up browsers independently.
- [x] Follow-up shutdown hardening uses a shorter runtime-shutdown Browserbase release timeout, releases active chat sessions in parallel, and aligns SIGTERM forced-exit grace with the bounded release retry window.
- [x] Verify direct behavior and downstream effects with focused Browserbase automation tests and `bun run check`.

## Issue 8 implementation notes

- [x] Remove duplicate model-facing workspace tools and register Pi-native `read`, `grep`, `find`, `ls`, `edit`, and `write` directly as the canonical workspace surface.
- [x] Rename remaining custom runtime tools to product-neutral names while preserving historical `agent_room_*` categorization and artifact tracking for old sessions.
- [x] Simplify the model-facing prompt and bundled office skill text so it describes workspace capabilities instead of Agent Room wrapper semantics.
- [x] Keep internal store path visibility policy canonical across file APIs, artifact extraction, and runtime event read models.
- [x] Persist per-room sandbox UID/GID/user/group metadata and expose it through runtime truth snapshots for auditability.
- [x] Materialize deterministic per-room Linux users and groups for shell-capable rooms, fail closed when sandbox identity cannot be created or validated, and chown only shell-writable workspace, store, home, and tmp paths to that identity. (Adjusted after review to keep backend-only runtime secrets out of same-room shell reach.)
- [x] Run shell/document worker processes through an explicit `setpriv` privilege-drop wrapper while the backend-owned runtime process keeps access to backend-only runtime config and secret materialization. (Adjusted from wrapping the whole runtime process after review showed same-room shell could otherwise read runtime secrets.)
- [x] Keep provider credential files and runtime config/env files backend-owned with restrictive modes so workspace shell tools cannot read tokens or provider metadata.
- [x] Keep runtime state, sessions, auth, model registry, thread index, and audit cursor files backend-owned while exposing only `home` and `tmp` as sandbox-owned subdirectories under state. (Explicit deviation from the original broad "state" ownership wording to avoid leaking backend-only session and audit metadata to same-room shell tools.)
- [x] Keep absolute workspace/store/home/tmp paths visible to sandboxed processes for POSIX cwd and tool compatibility, but derive production room filesystem roots from opaque deterministic ids so room ids, authentication, session ownership, runtime tokens, and audit ids remain backend-only. (Legacy room-id filesystem roots migrate during explicit layout materialization, while artifact/event path readers accept historical absolute paths under either root.)
- [x] Verify direct behavior and downstream effects with typecheck, the full local test suite, focused runtime/tool tests, and a root Linux container sandbox test that proves same-room runtime secrets and cross-room workspace, state, store, home, tmp, and runtime paths deny read/list/write access.
