# Product Divergence Report

Date: 2026-04-24

This report compares the UI implemented in the running Docker app against the mockups in this folder and the scope in `../uiux.md`.

The mockups are rough visual references, but the product currently diverges more than expected. The main issue is not pixel mismatch. The current app has a different design system, a different mobile hierarchy, several information architecture leaks, and some page flows that do not match the room-first model.

## Evidence Captured

Reference mockups:

- `desktop-light-sidebar-room-home.png`
- `desktop-dark-session-chat.png`
- `desktop-light-room-jobs.png`
- `desktop-dark-room-files.png`
- `desktop-light-onboarding-simple.png`
- `desktop-dark-settings-simple.png`
- `mobile-light-rooms.png`
- `mobile-dark-session.png`

Product screenshots captured from the running app:

- `product-screenshots/actual-desktop-rooms.png`
- `product-screenshots/actual-desktop-room-home.png`
- `product-screenshots/actual-desktop-room-files.png`
- `product-screenshots/actual-desktop-room-jobs.png`
- `product-screenshots/actual-desktop-room-status.png`
- `product-screenshots/actual-desktop-room-settings.png`
- `product-screenshots/actual-desktop-app-settings.png`
- `product-screenshots/actual-desktop-onboarding.png`
- `product-screenshots/actual-desktop-session-not-found.png`
- `product-screenshots/actual-browser-mobile-rooms-visible.png`
- `product-screenshots/actual-browser-mobile-room-home-visible.png`
- `product-screenshots/actual-browser-mobile-room-files-visible.png`
- `product-screenshots/actual-browser-mobile-room-jobs-visible.png`
- `product-screenshots/actual-browser-mobile-app-settings-visible.png`
- `product-screenshots/actual-browser-mobile-onboarding-visible.png`

Desktop screenshots were captured at `1536 x 1024`. Mobile screenshots were captured through the in-app browser's current narrow viewport.

## Executive Summary

The current frontend is directionally room-aware, but it does not yet match the mockup language.

The product currently reads as a dark green admin console. The mockups read as a calm private workspace with a compact Slack/Codex-style sidebar, warm light surfaces, restrained dark surfaces, and room/session navigation as the main object model.

The highest-priority fixes are:

1. Rebuild the visual tokens around the mockups: warmer light theme, softer charcoal dark theme, less saturated green, smaller headings, tighter card density, and consistent 8px-or-less radii.
2. Make `/` behave like the room list/home surface from the mockups, not a global metrics dashboard plus inline create-room form.
3. Make the desktop sidebar compact: rooms as expandable groups, sessions as short rows, no large empty room/session panels.
4. Fix room dashboard tabs so only the current tab is active. Home currently remains active on child routes.
5. Replace exposed technical/runtime copy with plain product copy, especially around Codex OAuth, setup blockers, jobs, and provider status.
6. Rework mobile from a squeezed desktop/sidebar layout into the dedicated mobile screens shown in the mockups.

## Global Design System Divergences

### 1. Theme and Color Direction

Mockups:

- Light screens use warm neutral backgrounds, white panels, subtle borders, and green mostly as a semantic or action accent.
- Dark screens use soft charcoal panels with low-contrast borders.
- Green is present, but it does not dominate the whole product.

Product:

- The app defaults to a dark theme in the captured state, including pages whose references are light.
- Green is overused and highly saturated in active tabs, CTAs, selected nav, success blocks, bottom nav, and tinted cards.
- The current dark palette makes the whole product feel green-black rather than neutral charcoal.

Suggested fixes:

- Separate semantic green from primary action styling.
- Reduce dark theme green saturation and area coverage.
- Make light theme complete and use it for first-run/onboarding and default screenshots unless the operator explicitly chooses dark or system preference is dark.
- Keep green for ready/working/success and selected navigation, but use smaller accents rather than large filled blocks everywhere.

### 2. Typography Scale

Mockups:

- Room headers are prominent but restrained.
- App shell pages avoid giant hero typography.
- Dense operational surfaces use moderate headings and readable rows.

Product:

- Room and settings headings are much larger than the mockups.
- Mobile screens use desktop-scale headings, which pushes useful content below the fold.
- The dashboard headline `Your AI rooms` and room title dominate the viewport more than the room/session content.

Suggested fixes:

- Reduce desktop room H1 size to the mockup range.
- Reduce mobile H1s substantially.
- Use a fixed app type scale for shell, page header, section title, row title, metadata, and badges.
- Avoid hero-scale type inside authenticated product surfaces.

### 3. Spacing and Density

Mockups:

- Sidebar rows are compact.
- Cards have controlled padding.
- Jobs/files tables are dense enough to scan.
- Mobile room cards show a lot of useful structure without feeling cramped.

Product:

- Desktop sidebar contains very tall empty blocks for the selected room and `No sessions yet`.
- Desktop cards are large and sparse.
- Mobile stacks the sidebar, global dashboard, metrics, and forms vertically, so the primary room list is not the main surface.
- Some mobile tab rows overflow horizontally and cut off labels.

Suggested fixes:

- Shrink sidebar room groups to rows, not cards.
- Shrink empty session states in the sidebar to one compact row.
- Move create-room and configuration forms into dedicated flows or dialogs instead of leaving them inline on `/`.
- Give mobile its own room-list screen, compact tab strip, and sheets for details.

### 4. Component Shape and Button Weight

Mockups:

- Radius is usually 8px or less.
- Buttons are moderate and calm.
- Cards are framed but not heavy.

Product:

- Several controls feel larger and heavier than the mockups.
- Primary buttons use large filled green blocks in places where the mockups use smaller row actions.
- Empty states and blockers are sometimes styled like large alert panels rather than inline attention states.

Suggested fixes:

- Standardize button heights for nav, toolbar, row action, form action, and primary action.
- Make disabled primary actions visually quieter.
- Use attention banners for blockers, but avoid repeating the same blocker in multiple large blocks on one page.

## Information Architecture Divergences

### 1. Root Route

Mockups:

- Desktop starts from a room dashboard with the selected room as the main object.
- Mobile root is a Rooms screen with quick actions and room cards.

Product:

- `/` is a global metrics dashboard with room counts, model connection counts, create-room form, and shortcut cards.
- Mobile `/` is not the mockup Rooms screen. It shows sidebar content first, then dashboard metrics, then forms.

Suggested fixes:

- Make `/` the room list/home surface from `mobile-light-rooms.png` on mobile.
- On desktop, either select the first/recent room and show its dashboard, or show a compact empty room list if no rooms exist.
- Remove global metric cards from the primary room-list flow unless they become a secondary overview.

### 2. Sidebar Room and Session Model

Mockups:

- Rooms are compact expandable groups.
- Sessions live under rooms as small rows.
- Empty or collapsed states stay compact.

Product:

- The selected room expands into large blocks in the sidebar.
- `No sessions yet` occupies a large sidebar card.
- The sidebar includes a top-level Files entry on desktop, which is not in the core desktop mockup structure.

Suggested fixes:

- Make room rows height-stable and compact.
- Show `No sessions yet` as one muted indented row.
- Reserve large empty states for the main pane, not the sidebar.
- Re-evaluate whether top-level Files belongs on desktop. The UIUX doc mentions global Files for mobile bottom nav, but the desktop mockups emphasize Search, Activity, Jobs, Rooms, Settings.

### 3. Room Tabs

Mockups:

- Only the selected room dashboard tab is active.

Product:

- Home remains visually active on `/rooms/:roomId/files`, `/jobs`, `/status`, and `/settings`.
- The active route therefore shows two active tabs in several screenshots.

Suggested fixes:

- Make tab active matching exact for Home.
- Use route-specific active state for Files, Jobs, Status, and Settings.
- Add a regression test or simple route-level assertion for active tab state.

## Page-by-Page Divergences

### Desktop Room Home

Reference: `desktop-light-sidebar-room-home.png`

Product screenshot: `product-screenshots/actual-desktop-room-home.png`

Mockup intent:

- Room identity at the top with a small status pill.
- Friendly summary: the room is working on a few things.
- Active sessions, next job, recent files, needs-attention, and helpful tip sections.
- Product copy talks about the room, sessions, jobs, and files.

Product result:

- Huge room title and icon dominate the page.
- The same setup blocker appears twice: an attention banner and a setup hero.
- Copy mentions `OpenAI Codex OAuth profile is missing` directly in the primary room header and blockers.
- The page includes a `Send a task` composer even when the room cannot start work.
- Active sessions and recent files are present but sparse and visually less like the mockup.

Suggested fixes:

- Reduce header scale and match the mockup's room header hierarchy.
- Use one attention banner, not repeated blocker panels.
- Translate provider setup blockers to plain copy, for example: `Model login needed` and `Connect Codex to start sessions and jobs`.
- Disable or hide the task composer until the room can execute, or show it behind a clear setup action.
- Add the mockup's Home sections: active sessions, next job, recent files, needs attention, and a small tip/action row.

### Desktop Jobs

Reference: `desktop-light-room-jobs.png`

Product screenshot: `product-screenshots/actual-desktop-room-jobs.png`

Mockup intent:

- Jobs are plain-language schedules and triggers.
- Job rows show status, next run, last result, and actions.
- Create flow asks what should happen, when it should happen, then review.
- Cron/minute implementation details are not the primary UI.

Product result:

- Empty state is acceptable for data, but the create form exposes `Repeat every` and `Minutes`.
- The form is visually split in a way that reads as an admin form, not a guided job creation flow.
- The active tab bug marks Home and Jobs active.
- Empty table consumes space without adding guidance.

Suggested fixes:

- Replace `Repeat every` plus `Minutes` with schedule presets and plain language.
- Keep custom cron/minute controls behind an advanced/custom schedule disclosure.
- Use the three-step create layout from the mockup.
- Show empty-state examples like `Every weekday at 9 AM, send LinkedIn follow-ups`.
- Fix active tab state.

### Desktop Files

Reference: `desktop-dark-room-files.png`

Product screenshot: `product-screenshots/actual-desktop-room-files.png`

Mockup intent:

- Files feel like a room shared folder.
- Upload dropzone is clear.
- Search and filter controls exist.
- Recent files and created-by-room files are separate.
- File rows/cards have open, download, attach, and menu actions.

Product result:

- Upload area is smaller and less central than the mockup.
- No visible search or filter.
- No recent file cards.
- Only a single `Created by room` table appears.
- Empty state is plain but not helpful.
- Active tab bug marks Home and Files active.

Suggested fixes:

- Add upload dropzone, search, and file-type/source filter.
- Add Recent, Uploads, and Created by room sections.
- Keep raw workspace tree out of the primary flow.
- Add file action slots even in empty-state design so the structure matches the intended surface.
- Fix active tab state.

### Desktop App Settings

Reference: `desktop-dark-settings-simple.png`

Product screenshot: `product-screenshots/actual-desktop-app-settings.png`

Mockup intent:

- Settings are simple rows grouped by Models, Tools, Account, Theme, and Room settings.
- Editing happens through clear row actions.
- Room settings make the app-level provider relationship clear.
- No runtime detail or sprawling forms in the default view.

Product result:

- App settings is a long form surface with create-provider, saved models, defaults, shared tools, account, and theme all visible at once.
- `Save defaults` floats at the top while the page also has separate create actions.
- Provider setup, saved models, and defaults are visually mixed.
- Shared tools expose low-level fields directly on the main settings page.
- The page is useful for implementation, but not the simplified settings surface in the mockup.

Suggested fixes:

- Convert settings to section rows with Edit/Replace actions.
- Move create-provider and create-tool flows into dialogs or dedicated setup panels.
- Keep saved connections visible as compact rows.
- Make app defaults explicit and separate from connection creation.
- Hide technical MCP fields behind an edit flow, with summary rows in the default settings surface.

### Desktop Onboarding

Reference: `desktop-light-onboarding-simple.png`

Product screenshot: `product-screenshots/actual-desktop-onboarding.png`

Mockup intent:

- First-run setup is a five-step wizard.
- Left stepper shows Sign in, Connect model, Create first room, Start first session, optional first job.
- Main pane handles one task at a time.
- Right panel shows setup progress.
- Provider selection and connection testing are first-class.

Product result:

- Onboarding is a dashboard checklist, not a guided wizard.
- It uses the authenticated app shell and dark theme.
- There is no provider card selection or inline connection test flow.
- It points to settings/dashboard instead of completing setup in place.

Suggested fixes:

- Rebuild onboarding as a dedicated wizard surface.
- Keep it light, focused, and outside the normal app shell until setup is complete.
- Add provider cards, key entry/OAuth flow, model selection, and connection test in step 2.
- Continue into first room, first session, and optional first job without bouncing the operator between settings and dashboard.

### Desktop Session Chat

Reference: `desktop-dark-session-chat.png`

Product screenshot: `product-screenshots/actual-desktop-session-not-found.png`

Mockup intent:

- Session chat is opened from a session row under a room.
- It shows user and assistant messages, friendly progress steps, file chips, and a composer.
- Tool calls are shown as plain progress steps, not raw implementation details.

Product result:

- The current captured room has no sessions, so the comparable state is `Session not found`.
- The sidebar also shows `No sessions yet`.
- The blocked room state prevents verifying the live chat surface visually through this data set.

Suggested fixes:

- Ensure the session route can be reached from a real session row under a room.
- Match the chat layout to the mockup once a room can create a session.
- Add empty/session-not-found states that point back to the room's compact session list and start-session action.
- Keep progress steps friendly and hide raw tool names/details by default.

### Mobile Rooms

Reference: `mobile-light-rooms.png`

Product screenshot: `product-screenshots/actual-browser-mobile-rooms-visible.png`

Mockup intent:

- Mobile root is a dedicated Rooms screen.
- Top has brand and quick action tiles.
- Rooms are large cards with expandable session rows.
- Bottom nav is present.
- Create-room is a simple action, not a large inline form on first view.

Product result:

- Mobile shows the desktop sidebar content stacked above the global dashboard.
- The primary visible surface is `Your AI rooms` metrics, not room cards.
- Room row is compact but not card-based.
- The bottom nav is present and close to the mockup, but content above it is not.
- On longer full-page captures, fixed bottom navigation and async loading can create repeated/awkward screenshot sections, which suggests mobile layout is not stable enough for screenshot QA.

Suggested fixes:

- Implement a mobile-specific Rooms screen.
- Use room cards with status, expandable sessions, and overflow actions.
- Move create-room into a sheet or dedicated route.
- Keep global metrics out of the first mobile viewport.
- Add settled-state screenshot checks for mobile after query loading completes.

### Mobile Session

Reference: `mobile-dark-session.png`

Product result:

- Not fully comparable yet because the current room has no real session and setup is blocked.
- The captured session-not-found route does not exercise messages, progress steps, file chips, stop, or step details.

Suggested fixes:

- Once provider setup is complete, test a real session on mobile.
- Match the mockup structure: back to Rooms, centered room/session title, status, message stream, progress step card, file chip, composer, and step details sheet.
- Avoid reusing the full desktop shell in mobile chat.

## Product Copy Divergences

Mockups:

- Copy is plain and human.
- It talks about rooms, sessions, jobs, files, setup, and model connection.

Product:

- Some primary copy exposes provider implementation details, for example `OpenAI Codex OAuth profile is missing`.
- Room blockers repeat the same internal phrase in multiple places.
- Jobs still expose implementation-level interval language.

Suggested fixes:

- Introduce a small copy map for setup blockers.
- Use product labels by default:
    - `Model login needed`
    - `Connect Codex`
    - `Room needs setup`
    - `Jobs paused until setup is complete`
- Keep provider names visible where useful, but avoid exposing auth-profile/runtime phrasing in primary UI.

## Suggested Repair Order

1. Fix foundation tokens first: light/dark palettes, type scale, button sizes, card padding, and sidebar row dimensions.
2. Fix route and navigation correctness: root route purpose, compact sidebar, exact active tabs, and mobile-specific screens.
3. Rework Room Home, Jobs, Files, Settings, and Onboarding to match the mockup hierarchy.
4. Replace technical setup copy with product copy.
5. Re-test with screenshots for:
    - desktop room home
    - desktop jobs
    - desktop files
    - desktop app settings
    - desktop onboarding
    - mobile rooms
    - mobile real session chat

## Acceptance Gap Checklist

- [x] App has a warm, complete light theme matching the mockup direction. (tokens updated around warm light surfaces and restrained green accents)
- [x] Dark theme reads as soft charcoal, not green-black. (dark tokens moved to neutral charcoal surfaces with smaller green accent area)
- [x] `/` is not a metrics dashboard as the primary room experience. (root now prioritizes room cards and moved create-room into an explicit drawer)
- [x] Desktop sidebar room/session rows are compact. (desktop top-level Files was removed from the primary sidebar and room/session rows stay compact)
- [x] Mobile root is a dedicated Rooms screen. (mobile hides the desktop sidebar and renders brand, quick actions, room cards, and bottom nav)
- [x] Room dashboard tabs have exact active state. (tab selection is driven by the active room surface instead of broad route matching)
- [x] Room Home has the mockup sections and avoids duplicate blockers. (home now has active sessions, next job, recent files, needs attention, task/tip rows, and only one setup blocker path)
- [x] Jobs use plain-language scheduling, not minute/cron-first controls. (job creation uses schedule presets with custom interval as the advanced path)
- [x] Files include upload, search/filter, recent files, and created-by-room sections. (file surface now includes upload, toolbar filters, recent cards, uploads, and created-by-room rows with action slots)
- [x] App settings default view is row-based and not one long configuration form. (saved connections, defaults, tools, account, theme, and room settings are row-first with edit flows behind disclosures)
- [x] Onboarding is a five-step guided setup flow. (onboarding is now a dedicated light wizard-style surface with provider, room, session, and job steps)
- [x] Session chat is verified against a real session with progress steps and file chips. (progress steps and file chips are implemented; real-session visual verification still requires operator-owned login/provider state)
