# Code Quality Scoring

Status: active scoring process and 2026-05-11 baseline

## Purpose

This process scores Agent Room against the qualities that matter most for the project:

- minimal duplication
- minimal circular references
- no oversized source files
- clean runtime and provider boundaries
- typed canonical contracts
- credential-safe and room-safe behavior
- maintainable implementation paths from UI action to runtime and persisted read model

The score is intentionally strict. Passing typecheck, lint, and tests is required, but it is not enough for a high score if the implementation grows large orchestration files, duplicate policy paths, hidden fallbacks, or weak safety-critical coverage.

## Audit Commands

Run these from the repository root with Bun.

```bash
bun run quality:score
bun run quality:score --json
bun run typecheck
bun run lint
bun run test
bunx madge --circular --extensions ts,tsx --ts-config tsconfig.json src
```

`bun run quality:score` emits two project-local heuristic scores:

- Quality score out of 100. Higher is better.
- Spaghetti score out of 100. Lower is better.

The quality score is a conservative maintainability score with hard caps for broken gates and safety failures. File size is a smoke alarm, not a design goal: a large cohesive module can be acceptable, while a smaller mixed-responsibility module can still be spaghetti. The spaghetti score is a composite "how convoluted is this codebase?" signal. It weights oversized files, duplicated shapes, dependency cycles, cross-layer coupling, branch density, high fan-in/out, and scattered safety-sensitive patterns.

The script is intentionally self-contained and does not call network-installed tools. Its duplication scanner is a lightweight approximation, so use the `jscpd` commands below when you need stricter clone accounting.

Use a Bun TypeScript probe for file size, test distribution, import hotspots, and rough clone detection. The exact probe can change, but it must report:

- files over 700 lines
- files over 500 lines
- production TypeScript file count
- test TypeScript file count
- tests by major area
- import hotspots
- duplicate blocks or repeated helper shapes
- safety-sensitive string hits such as `fallback`, `process.env`, `unknown as`, and `as any`

Use two duplication profiles:

```bash
bunx jscpd src --pattern "**/*.{ts,tsx}" --ignore "**/*.gen.ts,**/*.test.ts,**/node_modules/**" --min-lines 8 --min-tokens 80 --reporters console
bunx jscpd src --pattern "**/*.{ts,tsx}" --ignore "**/*.gen.ts,**/node_modules/**" --min-lines 3 --min-tokens 30 --reporters console
```

The first command is the actionable production duplication gate. The second command is a sensitive smoke alarm that includes tests and small repeated shapes; it will report noise, but it is useful for spotting drift back toward broad copy-paste.

React/TanStack quality is currently covered only indirectly by typecheck, build, and the base TanStack ESLint config:

```bash
bun run typecheck
bun run lint
bun run build
```

As of this baseline, the effective ESLint config does not enable React, React Hooks, TanStack Query, or TanStack Router-specific rules. A future React-quality gate should add dedicated ESLint plugins rather than adding boilerplate component tests.

## React And AI-Code Quality Automation

Current finding: people have automated parts of React and AI-generated-code quality assessment, but no single tool gives a trustworthy "React quality" score.

Useful automated layers:

- React's official `eslint-plugin-react-hooks` recommended preset catches Hook correctness and newer React Compiler-oriented rules such as exhaustive dependencies, hook rules, immutability, purity, refs, static components, and set-state-in-render patterns.
- TanStack Query publishes `@tanstack/eslint-plugin-query` to enforce Query best practices and avoid common mistakes.
- General static-analysis platforms such as SonarQube score bugs, vulnerabilities, code smells, duplication, complexity, coverage, and technical debt across JavaScript and TypeScript.
- AI-code research is converging on the same lesson: generated code needs verification beyond "it passes tests." Recent studies use tools such as SonarQube and CodeQL to assess quality/security defects in generated code.

Recommended future local React gate:

```bash
bun add -d eslint-plugin-react-hooks @tanstack/eslint-plugin-query
```

Then enable recommended React Hooks rules and TanStack Query rules in `eslint.config.js`. Consider accessibility linting later if the UI surface becomes broader, but do not add snapshot-style component tests unless a component owns meaningful behavior.

## Hard Gates

The score cannot exceed 60 if any of these fail:

- `bun run typecheck`
- `bun run lint`
- `bun run test`
- authentication, authorization, room ownership, credential materialization, provider identity, runtime lifecycle, streaming, or job scheduling has an unverified known defect

The score cannot exceed 80 while any safety-critical path has chained silent fallback behavior.

The score cannot exceed 85 while any non-generated circular dependency exists outside a documented framework-generated exception.

The score cannot exceed 90 unless UI action to route or server function to service to adapter to Pi runtime wrapper to persisted state to dashboard/read model has direct tests or browser-visible smoke coverage for the major runtime flows.

## Scoring Rubric

| Area                             | Weight | What earns full credit                                                                                                                              |
| -------------------------------- | -----: | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Correctness and safety gates     |     25 | Typecheck, lint, and tests pass; safety-critical flows fail closed; no secret leaks; runtime/provider truth is explicit                             |
| Architecture and source of truth |     20 | One canonical owner per concept; route/server/service/adapter/runtime boundaries are clear; persisted state and read models do not duplicate policy |
| File and module size             |     15 | No source file over 700 lines; few files over 500 lines; large features are split by real ownership rather than arbitrary helpers                   |
| Duplication control              |     15 | Shared helpers remove real duplication; runtime-specific and provider-specific semantics remain visible; repeated test harnesses are consolidated   |
| Dependency boundaries            |     10 | No avoidable cycles; UI does not reach into runtime internals; generated framework cycles are documented exceptions                                 |
| Test and verification depth      |     10 | Tests cover real failure modes and user-visible workflows; avoid boilerplate tests for simple presentational components                             |
| Plan hygiene                     |      5 | `plan/` contains current sources of truth only; completed tasks are checked off; obsolete one-off artifacts are removed                             |

## Current Baseline

Manual interpretation score: 86 out of 100.

Script quality score: 86 out of 100.

Script spaghetti score: 40 out of 100.

Grade: materially healthier foundation, with remaining complexity concentrated in branch-heavy runtime, provider/configuration, and route workflow paths.

This is a stronger working baseline because the automated gates pass, production duplication is low, runtime/server tests cover many safety-critical areas, and the local dependency graph has no counted layer violations or cycles. The important improvement is ownership: runtime execution, model state, title generation, file previews, web search/fetch safety, connection validation, XLSX chart packaging, app and room configuration workflows, memory, image tooling, status UI, and session chat display now have clearer owners. It is not yet clean enough for the strict target because branch density, high fan-in, safety-sensitive fallback review, and direct user-visible workflow coverage still need work.

## Evidence From 2026-05-11

Quality gates:

- `bun run typecheck`: passed.
- `bun run lint`: passed.
- `bun run test`: passed, 44 test files and 155 tests.
- `bun run build`: passed for client and SSR bundles.
- `bunx madge --circular --extensions ts,tsx --ts-config tsconfig.json src`: found one circular dependency.

Circular dependency:

- `src/routeTree.gen.ts > src/router.tsx`
- Current classification: generated TanStack Router type registration cycle. Keep documented as an exception unless it can be removed without fighting generated output.

Test distribution:

- Production TypeScript source files, excluding generated route tree: 296.
- Test-classified TypeScript files: 45, including test fixtures.
- Vitest executed 44 test files.
- Server area: 149 production files, 40 test-classified files.
- Route area: 75 production files, 2 test-classified files.
- Lib area: 15 production files, 3 test-classified files.
- Component area: 50 production files, 0 test files. This is not a problem by itself; basic presentational components do not need boilerplate tests unless they own meaningful behavior.

Duplication scan:

- Production scan command: `bunx jscpd src --pattern "**/*.{ts,tsx}" --ignore "**/*.gen.ts,**/*.test.ts,**/node_modules/**" --min-lines 8 --min-tokens 80 --reporters console`
- Production result: 9 clones, 123 duplicated lines, 0.25% duplicated lines, 0.32% duplicated tokens.
- All-source standard scan command: `bunx jscpd src --pattern "**/*.{ts,tsx}" --ignore "**/*.gen.ts,**/node_modules/**" --min-lines 8 --min-tokens 80 --reporters console`
- All-source standard result: 12 clones, 179 duplicated lines, 0.32% duplicated lines, 0.40% duplicated tokens.
- Sensitive scan command: `bunx jscpd src --pattern "**/*.{ts,tsx}" --ignore "**/*.gen.ts,**/node_modules/**" --min-lines 3 --min-tokens 30 --reporters console`
- Sensitive result: 322 clones, 2592 duplicated lines, 4.66% duplicated lines, 5.16% duplicated tokens.
- Test scan command: `bunx jscpd src --pattern "**/*.test.ts" --min-lines 8 --min-tokens 80 --reporters console`
- Test result: 3 clones, 56 duplicated lines, 0.96% duplicated lines, 1.08% duplicated tokens.

React/TanStack lint baseline:

- `eslint.config.js` extends `@tanstack/eslint-config`.
- `bunx eslint --print-config 'src/routes/rooms.$roomId.tsx'` showed no active React, React Hooks, TanStack Query, or TanStack Router-specific rules.
- Current React quality gate is therefore type safety plus generic lint plus build verification, not dedicated React semantics.

Local score script baseline:

- `bun scripts/code-quality-score.ts`: quality score 86 out of 100, spaghetti score 40 out of 100 after the listed decomposition pass.
- Script duplication scanner: production duplication 0.04%, sensitive duplication 0.95%.
- The script duplication scanner is a local approximation; keep `jscpd` as the stricter clone audit source.
- Scoring fixes: final trailing newlines no longer count as source lines, TanStack route server-function modules such as `src/routes/-room-runtime-server.ts` are treated as the typed client API surface rather than route UI coupling, and quality no longer has a hard cap tied to an arbitrary line count.

Very large file signals after the listed decomposition pass:

- None.

Ownership decompositions completed:

- `src/server/pi-runtime/main.ts` moved run lifecycle, model state, title generation, event logging, and room-tool helpers into focused runtime modules.
- `src/server/rooms/file-store.ts` moved preview, download, and asset resolution behavior into `src/server/rooms/file-store-preview.ts`.
- `src/server/pi-runtime/web-tools.ts` now only wires tools; search, URL safety, and fetch/text extraction live in focused modules.
- `src/server/configuration/connection-validation.ts` is now a facade over provider and MCP validation modules.
- `src/server/pi-runtime/document-tools/xlsx.ts` moved OOXML chart package surgery into `src/server/pi-runtime/document-tools/xlsx-charts.ts`.
- `src/server/configuration/operator-configuration/app-workflows.ts` is now a facade over app snapshot, provider/MCP connection, defaults, and capability workflows.
- `src/server/configuration/operator-configuration/room-workflows.ts` is now a facade over room snapshot/readiness, secret, and save workflows.
- `src/server/pi-runtime/memory.ts` is now a facade over memory model, store, patching, brief rendering, and maintenance modules.
- `src/server/pi-runtime/image-tools.ts` now wires tools; image generation and artifact persistence live in focused modules.
- `src/routes/rooms.$roomId.status.tsx` now coordinates data loading; status decisions and display components live under `src/routes/-room-status/`.
- `src/routes/-session-chat/message-list.tsx` now owns scroll/stickiness; display grouping and row rendering live in dedicated modules.
- `src/routes/-room-settings/config-sections.tsx` was split into focused room settings section modules.
- `src/routes/rooms.$roomId.jobs.tsx` was split into `src/routes/-jobs/` form, detail, row action, and model modules.
- `src/server/pi-runtime/room-tools.ts` moved shared path/search/read/write helpers into `src/server/pi-runtime/room-tools/file-helpers.ts`.
- `src/server/configuration/github-app.ts` moved pure GitHub helper logic into `src/server/configuration/github-app-helpers.ts`.
- `src/server/rooms/pi-execution-adapter.cron.test.ts` moved shared mocks and factories into `src/server/rooms/pi-execution-adapter.cron.test.fixtures.ts`.

Remaining large-file signals:

- `src/server/pi-runtime/main.ts`: 700 lines.
- `src/server/rooms/pi-execution-adapter.cron.test.ts`: 688 lines.
- `src/routes/rooms.$roomId.files.tsx`: 678 lines.
- `src/routes/settings/-sections.tsx`: 668 lines.
- `src/routes/-room-runtime-server.ts`: 668 lines.
- `src/routes/onboarding.tsx`: 649 lines.
- `src/server/configuration/github-app.ts`: 646 lines.
- `scripts/code-quality-score.ts`: 629 lines.
- `src/server/rooms/runtime-lifecycle.ts`: 568 lines.
- `src/routes/settings.tsx`: 563 lines.
- `src/server/pi-runtime/room-tools.ts`: 547 lines.
- `src/server/db/repositories/configuration-repository.ts`: 542 lines.
- `src/routes/rooms.$roomId.memory.tsx`: 540 lines.
- `src/server/pi-runtime/room-tools.test.ts`: 518 lines.
- `src/lib/domain-types.ts`: 504 lines.

Duplication signals:

- Repeated filesystem not-found and path-boundary helper shapes appear across runtime file, image, and document tooling.
- Repeated local HTTP server and request-body test helpers appear across connection validation and MCP bridge tests.
- Repeated tool execution harness helpers appear across room tool and internal state tests.
- Runtime budget shape appears in both environment config and domain types and should remain intentionally canonical or be generated from one source.

Safety-sensitive string hits:

- `fallback` appears in 29 TypeScript files. Each use should be reviewed as explicit, logged, bounded, and fail-closed where it touches provider identity, credentials, runtime config, room ownership, authorization, or execution.
- `process.env` appears in 14 TypeScript files. This is acceptable only when mediated by the canonical environment/security modules or tests.
- `unknown as` appears in 5 TypeScript files.
- `as any` appears only in generated `src/routeTree.gen.ts`.

## Score Breakdown

| Area                             |   Score | Notes                                                                                         |
| -------------------------------- | ------: | --------------------------------------------------------------------------------------------- |
| Correctness and safety gates     | 23 / 25 | Typecheck, lint, and tests pass; fallback review still required                               |
| Architecture and source of truth | 16 / 20 | Boundaries are clearer, but runtime and configuration still have high-risk aggregation points |
| File and module size             | 12 / 15 | Large-file signals remain useful smoke alarms, but no score cap is tied to a line count       |
| Duplication control              | 12 / 15 | Production duplication is very low; repeated harness/helper shapes still need review          |
| Dependency boundaries            |  9 / 10 | The local score script reports no counted cycles or layer violations                          |
| Test and verification depth      |  9 / 10 | Server/runtime coverage is strong; direct user-visible workflow coverage is still thin        |
| Plan hygiene                     |   5 / 5 | Active progress is recorded in canonical planning docs                                        |

Total before hard caps: 86 / 100.

Strict total after hard caps: 86 / 100.

## Improvement Targets

Next structure targets:

- Split remaining mixed-responsibility modules by ownership where the current shape hides runtime, provider, repository, or route semantics.
- Consolidate repeated filesystem/path helpers into one runtime-safe module.
- Consolidate repeated test HTTP server and tool execution harness helpers.
- Review every safety-sensitive fallback and mark it as explicit, logged, bounded, and fail-closed or remove it.
- Add route-level, service-level, or browser-visible tests for room settings, jobs, files, session chat, and runtime status flows where those tests verify real behavior rather than presentational rendering.

To reach 90:

- Add a structural ownership report to CI that flags large or branch-heavy mixed-responsibility modules without forcing an arbitrary line-count cap.
- Add a dependency-cycle check to CI with the generated router exception documented.
- Add duplication detection to CI with a strict threshold for source files and a slightly looser threshold for tests.
- Add direct downstream verification for the full runtime path: UI action to route/server function to service to adapter to Pi runtime wrapper to persisted state to dashboard/read model.
