# Code Quality Scoring

Status: active scoring process and 2026-05-18 baseline

## Purpose

This process scores Agent Room against the qualities that matter most for the project:

- minimal duplication
- minimal circular references
- cohesive modules with clear ownership
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
bunx madge --circular --extensions ts,tsx --ts-config apps/self-hosted/tsconfig.json apps/self-hosted/src
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
bunx jscpd apps/self-hosted/src --pattern "**/*.{ts,tsx}" --ignore "**/*.gen.ts,**/*.test.ts,**/node_modules/**" --min-lines 8 --min-tokens 80 --reporters console
bunx jscpd apps/self-hosted/src --pattern "**/*.{ts,tsx}" --ignore "**/*.gen.ts,**/node_modules/**" --min-lines 3 --min-tokens 30 --reporters console
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
| File and module ownership        |     15 | Large files remain visible smoke alarms, but scoring focuses on modules that combine size with broad fan-out, heavy branching, or mixed ownership   |
| Duplication control              |     15 | Shared helpers remove real duplication; runtime-specific and provider-specific semantics remain visible; repeated test harnesses are consolidated   |
| Dependency boundaries            |     10 | No avoidable cycles; UI does not reach into runtime internals; generated framework cycles are documented exceptions                                 |
| Test and verification depth      |     10 | Tests cover real failure modes and user-visible workflows; avoid boilerplate tests for simple presentational components                             |
| Plan hygiene                     |      5 | `plan/` contains current sources of truth only; completed tasks are checked off; obsolete one-off artifacts are removed                             |

## Current Baseline

Script quality score: 87 out of 100.

Script spaghetti score: 49 out of 100.

Grade: below the previous strict automated quality target after the workspace split, with remaining risk concentrated in ownership hotspots and package-aware scoring follow-up.

This baseline deliberately does not treat line count as a design goal. The score script still reports files over 500 and 700 lines, but size only contributes materially when paired with stronger risk signals such as heavy branching, high fan-out, or broad orchestration responsibility. Long cohesive UI or test modules remain visible for review without automatically dominating the score.

The dependency graph now has no counted cycles. The remaining layer violations are tracked as coupling debt rather than being hidden behind broad abstractions.

## Evidence From 2026-05-18

Quality gates:

- `bun run typecheck`: passed.
- `bun run lint`: passed.
- `bun run test`: passed, 98 test files and 400 passing tests with 1 skipped test across the app and domain package.
- `bun run check`: passed.

Test distribution:

- Production source files: 344.
- Test-classified files: 93.
- Generated files: 1.
- Server area: 200 production files, 81 test files.
- Route area: 78 production files, 9 test files.
- Lib area: 5 production files, 0 test files.
- Component area: 53 production files, 3 test files.

Duplication scan:

- Production scan command: `bunx jscpd apps/self-hosted/src --pattern "**/*.{ts,tsx}" --ignore "**/*.gen.ts,**/*.test.ts,**/node_modules/**" --min-lines 8 --min-tokens 80 --reporters console`
- Production result: 12 clones, 206 duplicated lines, 0.33% duplicated lines, 0.40% duplicated tokens.

React/TanStack lint baseline:

- `eslint.config.js` extends `@tanstack/eslint-config`.
- `bunx eslint --print-config 'apps/self-hosted/src/routes/rooms.$roomId.tsx'` showed no active React, React Hooks, TanStack Query, or TanStack Router-specific rules.
- Current React quality gate is therefore type safety plus generic lint plus build verification, not dedicated React semantics.

Local score script baseline:

- `bun run quality:score -- --json`: quality score 87 out of 100, spaghetti score 49 out of 100.
- Script duplication scanner: production duplication 0.08%, sensitive duplication 1.18%.
- The script duplication scanner is a local approximation; keep `jscpd` as the stricter clone audit source.
- Scoring fixes: final trailing newlines no longer count as source lines, TanStack route server-function modules such as `apps/self-hosted/src/routes/-room-runtime-server.ts` are treated as the typed client API surface rather than route UI coupling, quality has no hard cap tied to an arbitrary line count, and size scoring now counts compound ownership hotspots rather than raw long files.

Large file signals:

- `apps/self-hosted/src/server/configuration/github-app.ts`: 1353 lines.
- `apps/self-hosted/src/server/pi-runtime/browserbase-browser.test.ts`: 1177 lines.
- `apps/self-hosted/src/routes/-session-chat/session-chat-pane.tsx`: 1177 lines.
- `apps/self-hosted/src/routes/settings/-sections.tsx`: 1127 lines.
- `apps/self-hosted/src/server/pi-runtime/browserbase-browser.ts`: 1102 lines.
- `apps/self-hosted/src/routes/-session-chat/stream-state.ts`: 1049 lines.
- `apps/self-hosted/src/server/pi-runtime/web-tools.test.ts`: 985 lines.
- `apps/self-hosted/src/server/pi-runtime/main.ts`: 808 lines.
- `apps/self-hosted/src/routes/-room-runtime-server.ts`: 804 lines.
- `apps/self-hosted/src/routes/settings.tsx`: 787 lines.
- `apps/self-hosted/src/server/pi-runtime/office-document-skill.test.ts`: 753 lines.

Counted ownership hotspots:

- `apps/self-hosted/src/server/configuration/github-app.ts`: large branching module.
- `apps/self-hosted/src/server/pi-runtime/main.ts`: large broad runtime module with high fan-out.
- `apps/self-hosted/src/server/pi-runtime/browserbase-browser.ts`: large branching module.
- `apps/self-hosted/src/routes/settings.tsx`: large branching settings workflow.
- `apps/self-hosted/src/routes/-session-chat/session-chat-pane.tsx`: large broad session chat workflow.
- `apps/self-hosted/src/routes/-session-chat/stream-state.ts`: large branching stream-state reducer.

Ownership decompositions completed:

- `apps/self-hosted/src/server/pi-runtime/main.ts` moved run lifecycle, model state, title generation, event logging, and room-tool helpers into focused runtime modules.
- `apps/self-hosted/src/server/rooms/file-store.ts` moved preview, download, and asset resolution behavior into `apps/self-hosted/src/server/rooms/file-store-preview.ts`.
- `apps/self-hosted/src/server/pi-runtime/web-tools.ts` now only wires tools; search, URL safety, and fetch/text extraction live in focused modules.
- `apps/self-hosted/src/server/configuration/connection-validation.ts` is now a facade over provider and MCP validation modules.
- `apps/self-hosted/src/server/pi-runtime/document-tools/xlsx.ts` moved OOXML chart package surgery into `apps/self-hosted/src/server/pi-runtime/document-tools/xlsx-charts.ts`.
- `apps/self-hosted/src/server/configuration/operator-configuration/app-workflows.ts` is now a facade over app snapshot, provider/MCP connection, defaults, and capability workflows.
- `apps/self-hosted/src/server/configuration/operator-configuration/room-workflows.ts` is now a facade over room snapshot/readiness, secret, and save workflows.
- `apps/self-hosted/src/server/pi-runtime/memory.ts` is now a facade over memory model, store, patching, brief rendering, and maintenance modules.
- `apps/self-hosted/src/server/pi-runtime/image-tools.ts` now wires tools; image generation and artifact persistence live in focused modules.
- `apps/self-hosted/src/routes/rooms.$roomId.status.tsx` now coordinates data loading; status decisions and display components live under `apps/self-hosted/src/routes/-room-status/`.
- `apps/self-hosted/src/routes/-session-chat/message-list.tsx` now owns scroll/stickiness; display grouping and row rendering live in dedicated modules.
- `apps/self-hosted/src/routes/-room-settings/config-sections.tsx` was split into focused room settings section modules.
- `apps/self-hosted/src/routes/rooms.$roomId.jobs.tsx` was split into `apps/self-hosted/src/routes/-jobs/` form, detail, row action, and model modules.
- `apps/self-hosted/src/server/pi-runtime/room-tools.ts` moved shared path/search/read/write helpers into `apps/self-hosted/src/server/pi-runtime/room-tools/file-helpers.ts`.
- `apps/self-hosted/src/server/configuration/github-app.ts` moved pure GitHub helper logic into `apps/self-hosted/src/server/configuration/github-app-helpers.ts`.
- `apps/self-hosted/src/server/rooms/pi-execution-adapter.cron.test.ts` moved shared mocks and factories into `apps/self-hosted/src/server/rooms/pi-execution-adapter.cron.test.fixtures.ts`.

Duplication signals:

- Repeated filesystem not-found and path-boundary helper shapes appear across runtime file, image, and document tooling.
- Repeated local HTTP server and request-body test helpers appear across connection validation and MCP bridge tests.
- Repeated tool execution harness helpers appear across room tool and internal state tests.
- Runtime budget shape appears in both environment config and domain types and should remain intentionally canonical or be generated from one source.

Safety-sensitive string hits:

- `fallback` appears 52 times. Each use should be reviewed as explicit, logged, bounded, and fail-closed where it touches provider identity, credentials, runtime config, room ownership, authorization, or execution.
- `process.env` appears 27 times. This is acceptable only when mediated by the canonical environment/security modules or tests.
- `unknown as` appears 7 times.
- `as any` appears only in generated `apps/self-hosted/src/routeTree.gen.ts`.

## Score Breakdown

| Area                             |   Score | Notes                                                                                  |
| -------------------------------- | ------: | -------------------------------------------------------------------------------------- |
| Correctness and safety gates     | 24 / 25 | Typecheck, lint, and tests pass; fallback review still required                        |
| Architecture and source of truth | 18 / 20 | Boundaries are clearer, with remaining risk in six ownership hotspots                  |
| File and module ownership        | 13 / 15 | Long files are visible; only compound ownership hotspots materially affect the score   |
| Duplication control              | 13 / 15 | Production duplication is low; repeated harness/helper shapes still need review        |
| Dependency boundaries            |  9 / 10 | The local score script reports no counted cycles and 3 layer violations                |
| Test and verification depth      |  9 / 10 | Server/runtime coverage is strong; direct user-visible workflow coverage is still thin |
| Plan hygiene                     |   5 / 5 | Active progress is recorded in canonical planning docs                                 |

Total before hard caps: 87 / 100.

Strict total after hard caps: 87 / 100.

## Improvement Targets

Next structure targets:

- Split remaining mixed-responsibility modules by ownership where the current shape hides runtime, provider, repository, or route semantics.
- Consolidate repeated filesystem/path helpers into one runtime-safe module.
- Consolidate repeated test HTTP server and tool execution harness helpers.
- Review every safety-sensitive fallback and mark it as explicit, logged, bounded, and fail-closed or remove it.
- Add route-level, service-level, or browser-visible tests for room settings, jobs, files, session chat, and runtime status flows where those tests verify real behavior rather than presentational rendering.

To keep the score above 90:

- Keep the dependency graph cycle-free.
- Reduce the six counted ownership hotspots by extracting real runtime, provider, state, and route responsibilities.
- Add duplication detection to CI with a strict threshold for source files and a slightly looser threshold for tests.
- Add direct downstream verification for the full runtime path: UI action to route/server function to service to adapter to Pi runtime wrapper to persisted state to dashboard/read model.
