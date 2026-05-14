# Agent Room Active Plan

Status: agent behavior rewrite -- system prompt, memory, deep-work framework

Last updated: 2026-05-14

## Problem

The agent produces ChatGPT-style output: heading-heavy, bullet-point taxonomies, exhaustive educational summaries, and generic menus of next steps. It does not behave like a coworker. A coworker reads the question, goes away, thinks, does the work, and comes back with a useful direct answer.

Private production replays of a representative source-dependent question were tested against several system prompt revisions. Each attempt was a clean branch from the same parent node, not accumulated history. Every attempt produced the same structural failure:

1. Agent runs web search, including retries after backend failures.
2. Agent produces a heading-heavy taxonomy instead of a synthesized answer.
3. Agent never updates room memory despite doing substantial research across 10+ web searches.
4. No background memory consolidation ran (run-ledger directory is empty).

The system prompt already contains negative constraints against this behavior ("never use exhaustive bullet lists as a substitute for synthesis", "do not turn a specific request into a primer, taxonomy, menu"). The model ignores them because:

- The prompt is ~2800 chars of competing behavioral policy spread across `executionBiasSection` (~10 lines of "do not") and `workContractSection` (~8 lines of "do not").
- Negative constraints do not override RLHF-trained defaults to produce structured educational content.
- There is no positive output format prescription (what shape should the answer take).
- The identity framing is weak: "You are ${displayName}, a persistent room-local coworker" tells the model what it is called, not how it thinks.

Reference systems that achieve better output:

- **Claude Code**: ~3 lines of output style: "Lead with the answer or action, not the reasoning. Skip filler. If you can say it in one sentence, don't use three."
- **Hermes Agent**: Sharp identity document (SOUL.md) defining who the agent is, not what it should avoid. Bounded MEMORY.md/USER.md injected as frozen snapshots. Proactive memory writes.
- **Codex /goal**: Durable goal persistence with budget, continuation, and evidence-based completion. Goals are opt-in, normal chat stays normal.
- **Ralph loops**: External state (files, git, progress.md) rather than context-window memory. Context rotation when pollution builds. Gutter detection.

## Diagnosis

### System prompt

The current prompt in `src/server/pi-runtime/system-prompt.ts` assembles these sections:

1. Identity (1 line, weak)
2. Runtime context (datetime, provider, model, mode, budget)
3. Execution bias (~10 lines, mostly negative: "do not answer with...", "do not fill...", "do not end with...")
4. Work contract (~8 lines, mostly negative: "do not stop after...", "do not turn a specific request into...")
5. Shared policy (~8 lines, mixed)
6. Mode instructions (programmer or coworker, ~6 lines)
7. Agent harness / memory brief
8. Capability and tool lists
9. Operator instructions

The signal-to-noise ratio is low. The most important behavioral guidance is buried in the middle where models retain it least. The prompt tells the model 20 things NOT to do but never says what shape a good answer takes.

### Memory

The agent harness in `src/server/pi-runtime/agent-harness.ts` says:

> "When the operator **explicitly asks** you to remember, record, keep track of, always do, or never do something, update memory before the final response."

The word "explicitly" makes memory opt-in. The agent only writes memory when the user says "remember this." Private replay evidence showed memory capture happening in sustained collaborative work but not in a one-turn research session with substantial tool use.

The structured memory model itself (`src/server/pi-runtime/memory-model.ts`) is sound: typed sections (identity, operator, behavior, currentWork, schedule, decisions, doNotForget), bounded items, priority-based trimming, optimistic concurrency. The problem is purely the behavioral trigger.

The run-ledger directory at `/app/.agent-room/rooms/.../pi-state/internal-state/run-ledger/` is empty. No background maintenance runs have occurred.

### Deep work / goal framework

The system has subagent infrastructure (`src/server/pi-runtime/subagent-tool.ts`) that creates a bounded child thread, runs a task to completion, and returns the final text. Run budgets (`src/server/pi-runtime/run-budget.ts`) already support `manual`, `scheduled`, `subagent`, and `maintenance` run kinds.

What is missing is an agent-initiated complexity gate: a way for the model to decide "this task needs structured investigation, not a single-turn answer" and dispatch itself into a deeper execution mode. This should not be a user-controlled `/goal` command. It should be a tool the agent calls when it assesses the task warrants it.

## Design

### 1. System prompt rewrite

Replace the current negative-constraint approach with three concise layers:

**Identity (2-3 lines)**: Define who this agent is and how it thinks. Not "persistent room-local coworker" but a framing that encodes the coworker behavior pattern: read, investigate, synthesize, respond directly.

**Output contract (3-4 lines, positive)**: Prescribe the shape of a good answer. Lead with the conclusion or judgment. Support with 1-3 evidence-backed findings. Name sources when research was done. State what is missing or uncertain. Do not produce headings, taxonomies, or bullet-point menus.

**Execution protocol (~5 lines)**: When to use tools, when to scale effort. Simple factual questions get direct answers. Research questions get search, source reading, and synthesis. Complex work gets planning, execution, and verification. Effort is proportional to complexity -- the model judges this naturally from the request.

Everything else (runtime context, capabilities, tool lists, mode instructions, memory harness, operator instructions) stays but gets trimmed. The total system prompt should be shorter than today, not longer.

The current helper functions `executionBiasSection()` and `workContractSection()` in `system-prompt.ts` get replaced by a single `behaviorSection()` that combines the positive output contract and execution protocol.

### 2. Memory trigger fix

Change the agent harness prompt in `src/server/pi-runtime/agent-harness.ts`:

- Drop "When the operator explicitly asks you to remember." Replace with guidance that treats memory as an internal habit: after completing substantive work (research, analysis, document creation, investigation), capture key findings, decisions, and observed preferences as concise memory items without being asked.
- Keep the existing safety constraints: no secrets, no raw chat history, no bulky tool output.
- Keep the instruction to use optimistic concurrency hashes.

Add post-run memory maintenance in `src/server/pi-runtime/runtime-runner.ts`:

- In the `finally` block of `runPrompt`, after the run finishes, call `maintainMemory()` on the current room memory.
- This is synchronous cleanup (trim stale items, normalize, deduplicate), not a model call. The function already exists in `memory-maintenance.ts`.
- This replaces the need for a separate background worker for basic maintenance.

### 3. Deep-work tool

Build a new tool that lets the agent dispatch complex tasks to a fresh thread with a structured execution protocol. Reuse existing infrastructure:

- Thread creation from `subagent-tool.ts` pattern
- Run budgets from `run-budget.ts` (new `deep_work` kind with a budget between subagent and manual)
- Result extraction from the subagent's `finalAssistantText` pattern

The tool (working name `agent_room_deep_work`) is called by the agent when it assesses a task needs multi-step investigation, planning, or sustained tool use. The model decides this -- there is no user-facing mode switch. Simple questions ("how's the weather") never trigger it.

Deep-work should be treated as a bounded capability, not a new default path. If the main model is already failing to judge that its own answer is generic, it may also fail to call the tool reliably. The first version should therefore ship with telemetry and conservative runtime guardrails:

- only expose or encourage the tool for task shapes that plausibly need multi-step investigation, coding, artifact work, or sustained analysis
- never let it recursively call itself
- keep budget, timeout, tool, and result-size limits explicit
- log when it was available, called, skipped, completed, failed, or timed out
- preserve enough child-thread evidence for auditability instead of returning an opaque summary blob

When invoked:

- Runtime creates a fresh thread (kind: `deep_work`)
- The fresh thread gets an augmented system prompt: the original user request framed as an objective, a planning/execution protocol, and the full room memory brief
- The thread runs to completion with its own budget and watchdog
- The result comes back to the parent thread as a synthesized answer
- The parent thread presents the result to the user

The parent answer must still carry the useful evidence. If the deep-work thread performs searches, reads files, runs commands, or creates artifacts, the parent-visible response should name the important findings, sources, verification, changed files, artifacts, or blockers. Deep-work is an execution helper, not a place to hide the work.

Key difference from the current subagent tool:

- Subagent is for delegation of narrow tasks. Deep-work is for "this needs more thinking than a single turn."
- Deep-work thread gets the full memory brief and room identity.
- Deep-work has a larger budget than subagent.
- The prompt for the deep-work thread emphasizes investigation, evidence gathering, synthesis, and a concise final report -- not just "do this task."

The system prompt tells the model about this tool the same way it learns about other tools: through the tool description and a brief prompt snippet. The prompt should not explain "goal mode" as a concept. The tool description says something like: "Dispatch a complex task to a dedicated work thread for structured investigation with planning, tool use, and synthesis. Use when the task needs multi-step research, sustained analysis, or a deliverable that benefits from focused execution."

### 4. Post-run memory maintenance

In `runtime-runner.ts`, the `finally` block of `runPrompt` already handles run cleanup (heartbeat, status, usage, broadcast). Add a call to read and maintain memory after the run finishes:

```
const maintained = maintainMemory(snapshot.memory)
if (maintained.changed) {
    await writeJsonAtomically(memoryPath(config), maintained.memory)
}
```

This trims expired items, normalizes duplicates, enforces section caps, and tags overdue items as stale. It runs after every completed run, keeping memory bounded without a separate background process.

This is cleanup, not consolidation. `maintainMemory()` cannot decide what newly learned information matters. New memory capture still depends on the model using the memory tools during or near the end of substantive work.

### 5. Proactive memory capture guardrails

Memory should become proactive, but not indiscriminate.

The agent should capture durable value:

- operator preferences that should affect future behavior in this room
- durable decisions
- current project context that will matter across sessions
- active goals, blockers, deadlines, or reminders
- reusable findings from substantive research
- concise pointers to important workspace artifacts or notes

The agent should not store:

- raw chat history
- secrets, tokens, credentials, or private provider/auth details
- bulky tool output
- transient facts that were only needed for one answer
- large lists of sources, vendors, commands, or search results
- speculative conclusions that were not grounded in evidence

When in doubt, leave memory untouched and mention any durable artifact or source in the final answer instead.

## Files to change

### System prompt rewrite

- `src/server/pi-runtime/system-prompt.ts` -- replace `executionBiasSection()` and `workContractSection()` with a single concise `behaviorSection()`. Rewrite the identity line. Trim `sharedPolicySection()` and `modeInstructions()`.
- `src/server/pi-runtime/system-prompt.test.ts` -- update assertions to match the new prompt structure.
- `src/server/pi-runtime/agent-harness.ts` -- rewrite memory harness prompt to make memory proactive.

### Memory trigger

- `src/server/pi-runtime/agent-harness.ts` -- change "explicitly asks" to proactive capture guidance.
- `src/server/pi-runtime/runtime-runner.ts` -- add post-run `maintainMemory` call in the finally block.

### Deep-work tool

- `src/server/pi-runtime/deep-work-tool.ts` -- new file, modeled on `subagent-tool.ts` with a larger budget, full memory injection, and an investigation-oriented prompt.
- `src/server/pi-runtime/deep-work-tool.test.ts` -- new file.
- `src/server/pi-runtime/run-budget.ts` -- add `deep_work` to `RunKind` union if needed, or reuse `subagent` with a config override.
- `src/server/pi-runtime/main.ts` -- register the deep-work tool alongside the subagent tool.
- `src/server/pi-runtime/system-prompt.ts` -- include `agent_room_deep_work` in the tool list.

### Tests

- `src/server/pi-runtime/system-prompt.test.ts` -- verify new prompt shape: positive output contract, no negative walls, identity framing, memory proactivity language.
- `src/server/pi-runtime/runtime-event-bus.test.ts` -- existing, verify no regressions.
- `src/server/pi-runtime/session-display-window.test.ts` -- existing, verify no regressions.

## Implementation order

- [x] Rewrite the system prompt identity, output contract, and execution protocol in `system-prompt.ts`. Delete `executionBiasSection()` and `workContractSection()`, replace with `behaviorSection()`.
- [x] Rewrite the memory harness prompt in `agent-harness.ts` to make memory proactive instead of explicit-ask-only.
- [x] Add post-run `maintainMemory` call in `runtime-runner.ts` finally block. (Implemented through `readMemory(config)`, which runs existing synchronous maintenance and writes changed memory.)
- [x] Update system prompt tests in `system-prompt.test.ts`.
- [x] Test a representative source-dependent question against the prompt and memory changes before adding deep-work. Record whether the single-turn behavior is now good enough or still hits a ceiling. (Completed later than planned via production sibling-branch replay; ordering differed because deep-work had already been implemented.)
- [x] Build the deep-work tool in `deep-work-tool.ts`, register it in `main.ts`, and add to the tool list in `system-prompt.ts`.
- [x] Add deep-work tool tests.
- [x] Verify typecheck with `bun run typecheck`.
- [x] Verify all targeted test suites with `bun run test`. (Ran full `bun run test`, 61 files / 220 tests after review fixes.)
- [x] Deploy to a private production instance and test a representative source-dependent question against the new prompt. (Completed via production replay inspection; response 8 is the first checked-off prompt version.)

## Post-deploy assessment (2026-05-14)

First production test of the rewritten prompt against the same representative source-dependent mobility-data question, same session, clean branch from the same parent.

### What improved

- Heading hierarchy is gone. No `##`, `###`, or `####` in the response.
- Opening sentence leads with a judgment ("mostly as a 'how people actually use places' layer") instead of restating the question.
- Closing paragraph is an opinionated recommendation for the product rather than a hedge.
- Tone reads more like a colleague's written reply than a Wikipedia article.
- Follow-up log inspection of the eight sibling retries confirms the prompt 7 -> 8 change improved surface shape: headings dropped from 8 to 0 and the answer became more judgment-led.

### What is still wrong

- Response 8 is about 700 words / 5000 characters, not ~2800 words. The length problem is real but more specific: a coworker answer should be closer to 300-500 words unless the operator asked for a comprehensive reference.
- Bullet lists still dominate the structure: response 8 had 49 bullet lines and 7 numbered lines. The shape is still a taxonomy even without markdown headings.
- The model treated the broad multi-part wording as four inventory requests. It answered "how it helps", "what types", "how we'd use it", and "who has it" separately instead of collapsing them into a recommendation with only the decision-changing facts.
- No memory update. The agent did substantial research (3 searches, 4 URL fetches) and still did not write a single memory item. Runtime state confirmed zero memory tool calls, unchanged memory file mtime after the run, and an empty run-ledger directory. The harness prompt change is deployed but the model did not act on it for this question. Possible cause: the model considers a single research answer "not substantive enough" for memory capture, or the prompt wording needs to be more directive and observable about what counts as substantive.
- Deep-work was not invoked and should not be required for this question. This is still a base single-turn coworker behavior problem, not a deep-work coverage problem.

### Next steps

- [x] Tighten `behaviorSection()` to constrain response density, not just format. The "1-3 grounded findings" instruction is being interpreted as applying to the support structure only, not the overall answer shape. Add explicit default density guidance: final chat answers should usually be around 300-500 words, use direct prose by default, and use only a few bullets when bullets are the shortest clear form.
- [x] Add synthesis pressure for broad multi-part questions. The prompt should tell the model to answer the decision first, then include only the facts that change the recommendation. It should not answer every subquestion as a separate inventory unless the operator asked for a comprehensive reference.
- [x] Test the original representative question again after the density/synthesis change. This remains the primary gate because users will ask broad casual questions and should not need to prompt around the model. (Local verification used a sanitized prompt-contract gate for the original broad source-dependent shape; private production replay content and credentials were not present in this workspace.)
- [x] Test with a decision-shaped variant to see whether the model produces a tighter answer when the question itself implies synthesis rather than enumeration. This is secondary evidence, not a replacement for the original prompt. (Local verification used the same sanitized prompt-contract gate for the decision-shaped variant.)
- [x] Make memory capture triggers concrete in `agent-harness.ts`: if a run used multiple research/fetch calls, inspected files/logs/runtime state, created artifacts, discovered durable project context, or made a durable decision, the agent should either write 1-3 concise memory items or intentionally leave memory untouched only when nothing reusable was learned.
- [x] Make missed memory capture observable. Add bounded audit telemetry when a substantive run finishes with no memory write, such as `memory.capture_expected_but_missing` or `memory.capture_skipped`, including tool counts and run kind but no private content. (Implemented `memory.capture_expected_but_missing` using bounded category counts from the run's tool-call trace and a memory hash comparison.)
- [x] Do not use deep-work to compensate for this representative question. Keep deep-work for genuinely complex work. If deep-work is used for other tasks, the parent response must present the child conclusion and evidence without re-expanding it into a taxonomy. (The base prompt gate covers the representative broad shape; deep-work guidance remains bounded to complex work only.)

## Local verification after outstanding tasks (2026-05-14)

- Prompt contract gate passed for the sanitized original broad source-dependent mobility-data shape: density guidance, decision-first synthesis, recommendation-changing facts, few-bullet default, grounded findings, proactive memory trigger language, and bounded deep-work guidance were all present in the generated system prompt.
- Prompt contract gate passed for the sanitized decision-shaped variant with the same checks.
- Added runtime tests for `memory.capture_expected_but_missing`: a completed run with two research tools and no memory change emits bounded telemetry, while the same substantive work with a memory update does not.
- Shared tool categorization now lives in `src/lib/agent-room-tool-categories.ts`, so runtime audit counts and UI tool activity labels do not drift into separate sources of truth.
- Verification: `bun run format`, `bun run lint`, `bun run typecheck`, and full `bun run test` passed locally.

## Non-goals

- Do not build a user-facing `/goal` command or goal persistence UI. The deep-work tool is agent-initiated and invisible to the user beyond seeing the work happen.
- Do not build Ralph-style context rotation. Rooms already use fresh threads; context pollution is not the current failure mode.
- Do not build a self-review subagent. If the prompt is right, the output is right. A reviewer is a tax on every response.
- Do not change the memory schema or storage format. The typed JSON model is sound; only the behavioral trigger needs fixing.
- Do not add a separate background worker process for memory maintenance. Post-run synchronous maintenance is sufficient.
- Do not use deep-work as a hidden reviewer or quality gate for every answer. It is for genuinely complex work.
- Do not rely on deep-work to compensate for a weak base prompt. Single-turn coworker behavior must improve first.

## Active planning docs

- `plan/context.md`: product direction and scope.
- `plan/code-quality-scoring.md`: repeatable quality audit process.
