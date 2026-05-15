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

## Issue 1 implementation notes

- [x] Preserve uploaded PDFs as canonical room-local artifacts and materialize reads from that original file.
- [x] Add `agent_room_read_pdf` with native Anthropic document routing and rendered page-image routing for other vision-capable models.
- [x] Remove PDF text extraction from the model-facing tool surface so `agent_room_read_pdf` is the canonical PDF read path.
- [x] Persist and audit PDF ingestion mode as `native_document`, `image_render`, or `unsupported`.
- [x] Surface PDF ingestion mode in prompt attachment metadata, audit events, tool details, and model-visible attachment summaries.
- [x] Map Anthropic PDF payloads through Pi provider routing without claiming image-rendered or text-extracted content is native.
- [x] Ship the repo-owned `office-documents` skill and bundled script for DOCX, XLSX, and PPTX create, inspect, and edit workflows.
- [x] Package bundled skills into the production build so runtime resource loading resolves the shipped `SKILL.md` and script.
- [x] Remove dedicated DOCX/XLSX/PPTX runtime tools so the bundled skill and script are the single create, inspect, and edit implementation.
- [x] Verify active model changes drive PDF routing, page-range reporting is truthful, and non-contiguous rendered pages stay bounded to selected pages.
- [x] Verify direct behavior and downstream effects with `bun run check`.
