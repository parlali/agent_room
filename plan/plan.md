# Plan: proactive room onboarding, autostart, and personality

## Status

Implementation compiles and passes `bun run check`. Remaining unchecked items need migration/UI/E2E verification in a running deployment.

Deviations:

- Onboarding acknowledgment is produced by the onboarding runtime after it calls the dedicated personality tool, not by a server-side heuristic parser or hidden follow-up message.
- Post-autostart does not redirect or nudge. The onboarding session is available in the normal session list; the user may ignore it and edit the personality page later.
- `db/schema.sql` is ignored local dump output in this repo; the tracked durable schema change is the migration.
- Hidden onboarding opener prompts are marked before provider execution by prompt text and again by message id after materialization, so projection reads stay hidden while the async run is in flight.
- Existing pending onboarding sessions are retried until they contain a visible assistant opener; the retry reuses the canonical onboarding session instead of creating duplicates.
- Personality form sanitization is per-field and bounds freeform notes instead of replacing the whole form when one field is invalid.

## Direction

- [x] Rooms preserve operator intent to run, even when provider configuration is incomplete.
- [x] Rooms autostart after their own room-scoped credentials/configuration become valid, unless the operator manually paused the room.
- [x] App-wide provider/default changes never autostart rooms.
- [x] Manual pause is sticky. Only an explicit operator action resumes a manually paused room.
- [x] Rooms are fully functional before onboarding. Onboarding is personalization, not a gate. Sessions, prompts, and scheduled jobs all work using a default personality until onboarding completes.
- [x] A newly autostarted room opens a single onboarding chat where the assistant takes initiative and asks about the room's purpose and working style.
- [x] Onboarding is a single-pass, form-backed flow. The onboarding runtime saves the user's working-style answer through a dedicated structured personality tool, and the user can confirm or edit the result later.
- [x] If the user ignores onboarding and works in another session instead, the room continues to function with the default personality. No nudge or deferral transition is shown.
- [x] Personality is canonical typed state. Raw user prose is never injected into the system prompt.

## Product behavior contract

- [x] Initiative means taking safe obvious next steps before the final report, not appending "we can do this next" questions after completed work.
- [x] If the next step is clearly implied, safe, and within scope, the agent does it before responding.
- [x] If progress requires user judgment, the agent asks one specific blocker question instead of producing a long report.
- [x] If the task is complete, the agent returns a concise completed report without an open-ended follow-up prompt.
- [x] Onboarding state never blocks user prompts or scheduled jobs. The runtime uses a default personality when onboarding is incomplete.

## Data model and canonical state

- [x] Add an explicit room runtime/setup state that distinguishes config-blocked rooms from manually stopped rooms. Preserve `desiredState` as operator intent, not readiness.
- [x] Config-blocked rooms with `desiredState = running` autostart when their room-scoped configuration becomes valid.
- [x] Manually stopped rooms (`desiredState = stopped`) never autostart, regardless of configuration changes.
- [x] Add persistent onboarding state per room with fields for status (pending, completed, user-deferred), onboarding session id, and completion timestamps.
- [x] Add a typed personality form to canonical room memory.
- [x] The personality form contains: an archetype enum (selectable values defined in code), plus structured fields for tone, directness, report style, humor, challenge style, and bounded freeform notes.
- [x] Personality form values produced by the onboarding agent are stored the same way as user-edited values. There is no separate "agent draft" vs. "user confirmed" state.
- [x] Add migration/defaulting logic for existing rooms. Existing rooms get a default personality form, onboarding status set to user-deferred, and their current `desiredState` preserved so manually paused rooms stay paused.
- [x] Keep all new state room-local and auditable. Do not store raw chat transcripts, private prompts, provider secrets, or personal identifying evidence.

## Personality archetype and form

- [x] Define a fixed set of archetype enum values in code (for example: pragmatic builder, rigorous researcher, warm chief of staff, strategic challenger, concise operator). The exact list is part of the implementation, not user-editable.
- [x] Each archetype enum value maps, through trusted code, to a canonical system-prompt paragraph. The paragraph text lives in code.
- [x] The personality form is visible and editable to the user in room settings. The archetype field is a dropdown limited to the defined enum values. All other personality fields are structured (enums, sliders, or bounded text).
- [x] During onboarding, the onboarding runtime selects the archetype and fills the rest of the personality form by calling the dedicated personality tool. The result is saved as the room's personality, with no separate review step required.
- [x] If the user never visits the personality page, the onboarding-selected values stand. If the user edits the form later, their edits replace the prior values.
- [x] Unknown archetype ids, invalid enum values, or oversized freeform fields fall back to bounded defaults. Fail closed.
- [x] Add audit events for personality form creation and edits using sanitized field names and enum ids only. Do not log freeform text content.

## System prompt and memory rendering

- [x] Add base initiative rules to the shared system prompt without weakening safety, evidence, verification, credential, provider, or isolation rules.
- [x] Render the archetype paragraph into the system prompt by looking up the room's archetype enum and emitting the corresponding code-defined paragraph. Unknown or missing archetype falls back to a default paragraph.
- [x] Do not inject any other personality fields into the system prompt.
- [x] Keep the full personality form in the single canonical room memory object that the model already receives as memory. There is no separate personality payload passed to the model.
- [x] Render the archetype enum from that canonical personality object into the system prompt through trusted code.
- [x] Keep final-response instructions aligned with concise reports: no generic menus, no dangling "want me to" endings, and no unnecessary headings.
- [x] Add prompt tests that snapshot the rendered initiative rules and archetype paragraph without leaking secrets or runtime internals.
- [x] Add memory rendering tests that confirm personality fields are merged into the canonical user/room object and are clearly labeled.

## Autostart lifecycle

- [x] Update room creation so rooms requested to start retain `desiredState = running` even if provider configuration is not yet startable.
- [x] When startup is blocked by missing or invalid room-scoped configuration, mark the room as setup-required/config-blocked rather than changing operator intent.
- [x] After room-scoped provider configuration is saved and validated, start/reconcile the room if `desiredState === running`.
- [x] App-wide provider defaults and app-wide credential changes must not autostart any room.
- [x] Manual pause must win. Saving room-scoped config must not autostart a room with `desiredState === stopped`.
- [x] Log bounded audit events for blocked startup, config-ready autostart, successful autostart, and autostart failure.
- [x] Keep autostart bounded and explicit. Do not silently fall back to another provider, model, credential, or MCP config.

## Onboarding chat lifecycle

- [x] Add an idempotent `ensureRoomOnboardingStarted(roomId)` workflow that runs only after the room runtime is healthy and startable.
- [x] Create or reuse one onboarding session per room until onboarding status is no longer pending.
- [x] Title the onboarding session clearly enough for users to recognize it, without exposing internal implementation details.
- [x] Start onboarding with an assistant-initiated message. Do not store a fake user message such as "please onboard me" in the visible transcript.
- [x] If the runtime requires a prompt to produce the assistant message, store the internal onboarding instruction as internal/audit state and hide it from the user-facing chat projection. The projection filter must live at a single chokepoint so it cannot leak through other read paths.
- [x] The opener should infer what it can from room name and existing instructions, then ask one open question about the room's purpose and working style.
- [x] When the user replies, the onboarding runtime uses a focused onboarding prompt and one dedicated tool to save the personality form, including the archetype enum and structured fields.
- [x] After saving, the assistant sends a short acknowledgment in the onboarding chat that names the chosen working style in user-friendly terms and offers to start on the first task.
- [x] Mark onboarding status as completed once the personality tool call has saved the form.

## No-nudge onboarding behavior

- [x] If onboarding status is pending and the user opens or creates a session other than the onboarding session, do not surface a reminder and do not change onboarding status.
- [x] If the user never answers onboarding, the room continues to operate using the default personality. The personality page remains available for the user to fill in later.
- [x] Existing rooms migrated as user-deferred stay quiet and continue using the default personality unless the user edits the personality page.
- [x] Scheduled jobs run normally regardless of onboarding status.
- [x] Prevent duplicate onboarding runs when multiple sessions or browser tabs interact with the onboarding session concurrently.
- [x] Make onboarding lifecycle idempotent across runtime restart, page refresh, and reconnect.
- [x] Record audit events for onboarding creation and completion with sanitized session identifiers and enum ids only.

## UI and read models

- [x] Surface setup-required/config-blocked room state clearly in room lists, room header, status page, and settings.
- [x] After valid room-scoped configuration causes autostart, create the onboarding session without redirecting or nudging. The session is discoverable by its title in the normal session list.
- [x] If the user opens a different session while onboarding is pending, let the session work normally without changing onboarding status.
- [x] Add a personality page in room settings that renders the personality form, including the archetype dropdown and structured fields. The form is editable at any time.
- [x] Keep copy focused on the coworker experience, not runtime tokens, ports, prompt layers, or provider internals.
- [x] Ensure room settings and lifecycle controls still make manual pause/resume understandable after autostart is introduced.

## Tests and verification

- [x] Add unit tests for room creation preserving running intent when configuration is blocked.
- [x] Add service tests proving manual pause prevents later room-scoped config-save autostart. (covered at the autostart reconciler boundary)
- [x] Add service tests proving validated room-scoped provider config autostarts a desired-running room. (covered at the autostart reconciler boundary)
- [ ] Add service tests proving app-wide provider/default changes never autostart any room.
- [ ] Add migration tests confirming existing rooms get default personality, user-deferred onboarding status, and preserved `desiredState`.
- [ ] Add idempotency tests for `ensureRoomOnboardingStarted`.
- [x] Add runtime tests for assistant-initiated onboarding without a fake visible user message. (covers hidden pending/error/display projection paths)
- [x] Add tests for the projection filter that hides internal onboarding instructions across all chat read paths.
- [x] Add tests for the onboarding personality tool saving the personality form, including archetype enum selection and structured fields.
- [ ] Add tests confirming that submitting an onboarding reply completes onboarding after the personality tool call and triggers the acknowledgment message.
- [x] Remove nudge/defer behavior from the contract and implementation.
- [ ] Add tests confirming scheduled jobs run with the default personality when onboarding is pending or user-deferred.
- [x] Add memory tests for personality form persistence and single-source storage in the canonical user/room context object.
- [x] Add prompt snapshot tests for initiative rules and rendered archetype paragraph.
- [x] Add tests for the personality renderer dropping unknown archetype ids, invalid enum values, and oversized freeform fields.
- [ ] Add UI tests for setup-required state, personality page editing, and archetype dropdown constraints.
- [x] Verify direct behavior with focused tests plus `bun run check`.
- [ ] Verify downstream effects manually or with browser-visible tests: create room before provider config, add valid room-scoped provider, observe autostart, observe onboarding chat, reply once, observe personality form populated and acknowledgment message, start a normal task, then edit personality via the settings page.

## Implementation order

- [x] Implement canonical state and migrations first, including personality form schema, archetype enum, and onboarding status.
- [x] Implement lifecycle/autostart reconciliation second.
- [x] Implement system-prompt initiative rules and archetype paragraph rendering third, with a default archetype available so later steps can rely on rendered output.
- [x] Implement onboarding session creation, opener message, personality tool save, and acknowledgment fourth.
- [x] Implement personality settings page and read-model surfaces fifth.
- [x] Add and run focused tests alongside each layer.
- [ ] Finish with end-to-end verification and update this plan with checked items and brief deviation notes. (`bun run check` passed; browser/manual E2E remains)
