# Agent Room PDF And Search Reliability Plan

## Goal

Agent Room should make document understanding and web access feel seamless to the end user.

For PDFs, the model should receive the original PDF file whenever the selected provider/runtime supports native PDF input. Text extraction, page previews, and PDF-specific tools remain useful, but they are fallbacks or explicit inspection/editing tools, not the default path for reading a PDF.

For web search and page access, the user should see one coherent capability: search works out of the box with bundled SearXNG, and works better when production-grade provider keys are configured. The model should not see separate SearXNG, Brave, Browserbase, and native fetch tools. It should see stable Agent Room tools backed by a smarter harness.

## Current Context

The current `agent_room_web_search` implementation calls SearXNG directly through `searxngSearch` in `src/server/pi-runtime/web-search.ts`. Production logs from the `parsa` instance showed SearXNG upstream engine failures, including rate limits and CAPTCHA responses from public search engines. The app stayed up, but search quality and reliability degraded.

The current document tool work improved PDF text extraction and simple PDF edits, but that does not solve the main PDF issue. Some providers can parse PDF files natively. Agent Room should pass PDFs as native provider file/document inputs when possible instead of forcing extraction to markdown/plain text.

Brave Search is a search API and should be treated as a production search backend. For this plan, only Brave web search is in scope. Brave Answers, images, news, local enrichments, suggest, spellcheck, and other Brave-specific products are out of scope unless a later plan explicitly adds them.

Browserbase is not a search index. It is a browser/fetch/automation backend. It can improve URL fetching, dynamic page access, browser sessions, and future browser automation. It should back Agent Room fetch/browser capabilities, not replace general search.

## Non-Negotiables

- Keep a single model-facing web search tool: `agent_room_web_search`.
- Keep a single model-facing URL/page fetch tool unless a future browser-control tool is intentionally added.
- Do not expose `agent_room_brave_search`, `agent_room_searxng_search`, or `agent_room_browserbase_fetch` to the model.
- Provider routing is an internal harness concern.
- Search must fail explicitly and auditably when every configured backend is unavailable.
- SearXNG remains the default bundled search path.
- Brave Search is an optional production search source.
- Browserbase is an optional production fetch/browser source.
- Never silently downgrade provider identity, credentials, room ownership, search backend, or document ingestion mode.
- Every fallback must be explicit, logged, bounded, and visible in tool details or runtime audit events.

## Desired Architecture

Introduce canonical provider contracts behind the existing Agent Room tools.

Search:

```ts
type SearchProviderId = 'searxng' | 'brave'

interface SearchProvider {
    id: SearchProviderId
    label: string
    priority: number
    isConfigured(config: PiRuntimeConfig): boolean
    search(input: SearchProviderInput): Promise<SearchProviderResult>
}
```

Fetch/browser:

```ts
type FetchProviderId = 'native' | 'browserbase'

interface FetchProvider {
    id: FetchProviderId
    label: string
    priority: number
    isConfigured(config: PiRuntimeConfig): boolean
    fetch(input: FetchProviderInput): Promise<FetchProviderResult>
}
```

Document input:

```ts
interface NativeDocumentInputCapability {
    mimeTypes: string[]
    maxBytes: number
    maxPages?: number
    provider: string
    api: string
}
```

The model-facing tools remain stable:

- `agent_room_web_search` routes through `SearchRouter`.
- `agent_room_fetch_url` routes through `FetchRouter`.
- Attachment materialization routes PDFs through native document input when supported.
- PDF extraction tools are retained as explicit tools and fallback paths.

## Plan

- [ ] Replace PDF extraction-first behavior with native PDF input where supported
    - Add a typed provider capability map for native document inputs, starting with PDFs.
    - Trace the full path from UI attachment or workspace file reference to prompt attachment preparation, adapter payload mapping, Pi runtime session prompt, and persisted runtime state.
    - Keep the original PDF as the canonical attachment artifact. Do not create markdown/PDF derivatives as the default model input path.
    - When the active provider supports PDF input, send the PDF as a native file/document part with the correct MIME type and provider-specific payload shape.
    - Persist and audit the ingestion mode for each attachment: `native_pdf`, `pdf_text_fallback`, `pdf_preview_fallback`, or `unsupported`.
    - Use PDF text extraction only when native PDF input is unsupported or an explicit PDF text extraction tool is called.
    - Make native PDF failures fail closed for credential/provider/payload errors. Do not silently pretend the model saw the original PDF if it only saw extracted text.
    - Update model instructions so the agent knows PDFs may be available as native attachments and should not shell-extract them unless the tool reports a fallback or the user asks for extraction.
    - Add tests covering native PDF materialization, unsupported-provider fallback, oversized PDF handling, and persisted/audited ingestion mode.

- [ ] Harden SearXNG and keep it as the built-in default search backend
    - Refactor current `searxngSearch` into a `SearchProvider` implementation rather than calling it directly from `agent_room_web_search`.
    - Add bounded retries only for transient network/timeouts. Do not retry CAPTCHA, 403, 429, or explicit upstream blocking as if they were ordinary failures.
    - Track per-backend and per-engine health in memory with short TTL backoff for rate-limited or CAPTCHA-blocked engines.
    - Normalize SearXNG failures into typed errors: `rate_limited`, `captcha`, `blocked`, `timeout`, `bad_response`, `empty_results`, and `misconfigured`.
    - Improve default SearXNG request headers and config while staying honest about limits of public search scraping.
    - Add query de-duplication within a run so repeated identical searches share the same in-flight result.
    - Add a small per-room/run search budget to prevent accidental bursts from hammering SearXNG.
    - Include backend, result count, fallback reason, and health state in tool result details and audit events.
    - Surface degraded search backend state in settings/status without exposing private query content.
    - Add tests for JSON path, HTML fallback path, rate-limit/CAPTCHA classification, health backoff, and no silent empty success.

- [ ] Add Brave Search as an optional production search source
    - Add typed app/operator configuration for Brave Search:
        - enabled flag
        - API key secret reference
        - optional country
        - optional search language
        - optional safe search default
        - timeout
        - result count
    - Add settings UI in the existing capabilities/configuration area. The UI copy should present this as “Search works by default. Add Brave Search for more reliable production search.”
    - Store the Brave key through the existing secret handling path. Do not store it in plaintext config or runtime logs.
    - Add connection validation that calls the same Brave web search endpoint used by rooms.
    - Implement only Brave Web Search API support. Do not implement Brave Answers, image search, news search, local search, suggest, spellcheck, or LLM context in this plan.
    - Map Brave web results into the same canonical `WebSearchResult` shape used by SearXNG.
    - Add Brave as higher priority than SearXNG when configured and healthy.
    - If Brave fails because of auth, quota, billing, or permanent request errors, fail closed for that provider and fall back to SearXNG only when the configuration explicitly allows fallback.
    - Audit provider selection and fallback reason without logging the secret.
    - Add tests for validation, provider routing, Brave result mapping, auth failure, quota/rate-limit failure, and SearXNG fallback.

- [ ] Add Browserbase as an optional fetch/browser source
    - Add typed app/operator configuration for Browserbase:
        - enabled flag
        - API key secret reference
        - project ID or required Browserbase project identifier if needed by their API
        - fetch enabled
        - browser sessions enabled
        - timeout
        - max fetched bytes
        - allowed fallback to native fetch
    - Add settings UI in the same capability-source area. Present Browserbase as stronger page access/browser automation, not as search.
    - Store Browserbase credentials through the existing secret handling path.
    - Add connection validation using the same Browserbase endpoint that runtime fetch will use.
    - Refactor `agent_room_fetch_url` so it routes through `FetchRouter`.
    - Keep native fetch as the default free fetch provider.
    - Use Browserbase Fetch for configured production page reads where it is enabled.
    - Preserve existing SSRF protections, URL sanitization, output bounds, content-type handling, and audit behavior.
    - If Browserbase fetch fails, fall back to native fetch only when fallback is explicitly enabled and the failure is not an auth/configuration failure.
    - Do not add separate model-facing Browserbase tools in this plan.
    - Add tests for Browserbase fetch mapping, auth failure, fallback behavior, content bounds, URL audit sanitization, and native fetch default behavior.

- [ ] Make search and fetch seamless to the model
    - Keep tool names stable: `agent_room_web_search` and `agent_room_fetch_url`.
    - Update prompt snippets to describe capability, not backend. Example: “Searches the web through the best configured Agent Room search backend and returns cited results.”
    - Return tool details that include backend metadata for auditability, but avoid making the model reason about backend names unless a backend failure affects the answer.
    - Add router-level result annotations:
        - `backend`
        - `backendLabel`
        - `fallbackChain`
        - `degraded`
        - `degradedReason`
        - `resultCount`
    - Add runtime audit events for provider selection, fallback, degraded search, and final failure.
    - Ensure user-visible status says search is ready when at least one backend is configured and healthy enough to try.
    - Ensure settings separates “basic built-in search” from “production search source” without making users pick a model-facing tool.

- [ ] Configuration and persistence cleanup
    - Replace the current single search config shape with a canonical typed shape that can support default SearXNG plus optional Brave.
    - Add migration/normalization so existing configs continue to work.
    - Keep a single source of truth for search readiness in runtime materialization, settings snapshot, room status, and tool registration.
    - Add secret references rather than raw keys to materialized room config.
    - Redact Brave and Browserbase credentials from runtime state, logs, audits, browser responses, test snapshots, and error messages.
    - Update type tests and config normalization tests.

- [ ] Verification
    - Add unit tests for `SearchRouter`, `SearxngSearchProvider`, `BraveSearchProvider`, `FetchRouter`, and `BrowserbaseFetchProvider`.
    - Add integration tests proving rooms expose only one web search tool and one URL fetch tool regardless of configured providers.
    - Add connection validation tests using the same runtime materialization path used by rooms.
    - Add runtime/audit tests proving fallback chains are explicit and auth/config failures fail closed.
    - Add UI tests for settings validation states where practical.
    - Run `bun run format`, `bun run typecheck`, `bun run lint`, focused tests, and `bun run build`.

## Acceptance Criteria

- A PDF attached to a room using a PDF-capable provider is sent as native PDF input, not extracted text.
- Unsupported PDF providers degrade explicitly to bounded extraction or report unsupported state.
- The model no longer receives backend-specific duplicate search/fetch tools.
- SearXNG remains usable with zero additional user configuration.
- SearXNG blocking/rate limits are classified, logged, and shown as degraded rather than silent success.
- Brave Search can be configured in settings and becomes the preferred search backend when healthy.
- Brave implementation uses only web search.
- Browserbase can be configured in settings and becomes the preferred fetch/browser backend when enabled.
- Browserbase is not treated as a general search index.
- Search “just works” from the user perspective: built-in by default, better with a key.
- Every fallback is typed, audited, bounded, and test-covered.
