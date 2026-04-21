# Agent Room UI/UX Mockups

These images are visual references for the corrected frontend direction in `../uiux.md`.

Follow `../uiux.md` when image text or layout details conflict with the product scope.

## Direction

- Brand is Agent Room.
- No OpenClaw logo or app name.
- One sidebar.
- Rooms are expandable groups.
- Sessions live under rooms.
- Clicking a room opens the room dashboard.
- Clicking a session opens that session chat.
- Room dashboard tabs are Home, Files, Jobs, Status, Settings.
- No dashboard Chats tab.
- No top-level New chat.
- No runtime internals in normal product UI.
- Jobs are plain-language schedules and triggers.
- Status means model connection, job health, setup state, and useful attention states.

## Files

- `desktop-light-sidebar-room-home.png`: desktop light app shell with one sidebar, expandable rooms, sessions under rooms, and a simple room Home dashboard.
- `desktop-dark-session-chat.png`: desktop dark session chat opened from a session under a room, with friendly progress steps.
- `desktop-light-room-jobs.png`: desktop light room Jobs tab for schedules and triggers in plain language.
- `desktop-dark-room-files.png`: desktop dark room Files tab as a shared folder/output surface.
- `desktop-light-onboarding-simple.png`: desktop light first-run setup with provider and first room flow.
- `desktop-dark-settings-simple.png`: desktop dark app and room settings without runtime details.
- `mobile-light-rooms.png`: mobile light room/session home.
- `mobile-dark-session.png`: mobile dark session chat.

## Intended Use

Use these images to guide:

- Layout hierarchy.
- Sidebar behavior.
- Room/session relationship.
- Mobile simplification.
- Friendly copy.
- Light and dark themes.
- Component density.

Do not copy generated labels blindly. The implementation should use typed backend data and product language from `../uiux.md`.
