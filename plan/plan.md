# Agent Room Active Plan

Status: structure-first code quality refinement captured

Last updated: 2026-05-11

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

## Active Planning Docs

- `plan/context.md`: product direction and scope.
- `plan/architecture.md`: canonical runtime, isolation, and data-flow architecture.
- `plan/uiux.md`: current user-facing product surface and interaction direction.
- `plan/code-quality-scoring.md`: repeatable quality audit process, score rubric, current baseline, and improvement targets.

## Cleanup Notes

Removed the old `plan/spikes/` notes and `plan/uiux-mockups/` generated images from the active planning tree because they were historical implementation aids rather than current sources of truth.

The active planning surface should stay small. New research belongs in `plan/` only when it is still guiding current implementation, and completed one-off artifacts should be removed or folded into the canonical docs above.
