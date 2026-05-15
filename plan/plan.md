# Plan: docs, search, and browser automation work streams

## Status

The brainstorm has been split into three public OSS work-stream issues. Implementation now lives in the issues.

## Filed issues

- [x] Issue 1: [Docs reliability — native PDF input and office doc hardening](https://github.com/parlali/agent_room/issues/1)
- [x] Issue 2: [Search reliability — SearXNG hardening, Brave, and Browserbase search](https://github.com/parlali/agent_room/issues/2)
- [x] Issue 3: [Browser automation — interaction tools and live session UI](https://github.com/parlali/agent_room/issues/3)

## Filing tasks

- [x] Add `.github/ISSUE_TEMPLATE/plan_work_stream.yml` for plan-derived streams.
- [x] File Issue 1 (Docs reliability) using the template.
- [x] File Issue 2 (Search reliability) using the template.
- [x] File Issue 3 (Browser automation) using the template.
- [x] Replace this document with a short pointer to the three filed issues once they are created.

## Implementation notes

- [x] Issue 2 search implementation keeps one model-facing `agent_room_web_search` tool and routes Brave, Browserbase browser-mediated search, then SearXNG behind typed provider contracts. Browserbase browser-mediated search currently drives Brave Search internally as the provider-owned browser search engine choice.
- [x] SearXNG engine health records rate-limited and CAPTCHA-blocked engines with short TTL and sends those engines as disabled on later SearXNG requests where supported.
- [x] PR review hardening keeps Browserbase CDP commands and session release bounded by provider timeouts, removes provider response bodies from model-visible search failure metadata, and rolls back search credential writes on rejected settings saves.
- [x] Search implementation is split into shared contracts/helpers, SearXNG, Brave, Browserbase, and router modules so provider parsing, browser session control, and routing state each have focused ownership.
