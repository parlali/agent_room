# Agent Room UI/UX Scope

Status: corrected product scope for the frontend rebuild.

This document is the UI source of truth for the next frontend implementation pass. It intentionally replaces the earlier operator-console direction. Agent Room should feel simple, approachable, and obvious. The backend can remain technically rigorous, but the product UX must not expose runtime machinery unless it directly helps a normal operator complete work.

## Product Definition

Agent Room is a self-hosted web portal for persistent AI rooms.

Each room is a durable worker with its own:

- Sessions.
- Files.
- Jobs.
- Status.
- Settings.
- Memory and instructions where the product needs to expose them.

Internally a room is currently powered by one dedicated runtime instance. That implementation detail does not define the product UI. The product is Agent Room, not an OpenClaw dashboard.

The hierarchy is:

```text
Agent Room
    Sidebar
        Room
            Session
    Room dashboard
        Home
        Files
        Jobs
        Status
        Settings
    Session chat
```

The sidebar is the primary navigation. Rooms appear as expandable groups. Sessions live under their room. Room-level features live in dashboard tabs. There is no second sidebar.

## Product Promise

One Docker command gives the user a private web portal. After login, they can open the portal from desktop or mobile and manage rooms, sessions, files, jobs, and settings without understanding the underlying runtime.

The target user should think:

```text
I have a few AI rooms.
Each room can work on many conversations.
Each room can keep files.
Each room can run scheduled jobs.
I can see what needs attention.
I can use this from my phone.
```

They should not think:

```text
I need to understand runtimes, ports, tokens, payloads, process state, config paths, or gateway internals.
```

## Design Principles

- Make the common path obvious.
- Keep one navigation model.
- Hide implementation detail.
- Prefer plain language over platform terms.
- Show only useful status.
- Make mobile a first-class surface.
- Keep details progressive and task-specific.
- Do not duplicate runtime state into a new product concept.
- Do not expose multiple ways to do the same thing.
- Do not map the underlying runtime one-to-one.

## Brand Direction

The app brand is Agent Room.

OpenClaw should not appear as the app name, app logo, sidebar brand, or core product identity. If runtime implementation is mentioned at all, it belongs in internal docs or a narrowly scoped technical note, not normal product surfaces.

Visual identity:

- Name: Agent Room.
- Logo concept: a simple room/door/window glyph, or an abstract set of connected rooms.
- Tone: calm, capable, friendly, private.
- Avoid claws, animals, runtime logos, terminal motifs, and developer-tool branding.

The UI should feel closer to ChatGPT/Codex project navigation, Slack room simplicity, and a personal workspace than to VS Code, Grafana, Kubernetes dashboards, or runtime consoles.

## Information Architecture

### Sidebar

The sidebar is the main app structure.

Top actions:

- Search.
- Automations or Jobs overview.
- Activity or Needs attention.

Main section:

- Rooms.
- Each room is expandable.
- Each room shows recent or active sessions.

Bottom actions:

- Add room.
- App settings.
- User/account menu.

There is no top-level New chat. A new session only makes sense inside a room.

Room row behavior:

- Click room row: open the room dashboard.
- Expand/collapse room: show or hide recent sessions.
- Hover room row on desktop: show new session and room menu actions.
- Long press or trailing menu on mobile: show room actions.
- Room row can show a small status dot or attention badge.

Session row behavior:

- Click session: open the session chat.
- Recent active sessions are visible under each expanded room.
- Show more reveals the full session list for that room.
- Session rows show a short title and small timestamp or status.

The sidebar should be compact and familiar. It must not become a data table.

### Room Dashboard

Clicking a room opens its dashboard.

Room dashboard tabs:

- Home.
- Files.
- Jobs.
- Status.
- Settings.

No Chats tab. Sessions already live under the room in the sidebar.

Desktop:

- Sidebar remains visible.
- Room dashboard fills the main pane.
- Tabs sit under the room header.
- Details open inline or in simple dialogs.

Mobile:

- Sidebar becomes the home screen and room switcher.
- Room dashboard uses a top header and compact tabs.
- Tabs may become a horizontal scroll strip or a More menu if needed.
- No nested sidebars.

### Session Chat

Clicking a session opens that session.

Session chat is the full conversation view for one session inside one room.

It should show:

- The room name.
- The session title.
- Simple session state: working, waiting, done, needs attention.
- Messages.
- Friendly progress steps.
- Files created or used.
- Composer.

Assistant messages should be visually attributed to the room identity, not to the app brand. For example, a message in the Personal room can show Personal as the responder. Agent Room is the application shell, not the name of every assistant message.

It should not show:

- Runtime ids.
- Process data.
- Raw JSON.
- Tool payloads.
- Provider payloads.
- Internal paths.

Technical detail can exist only as a narrowly scoped "Details" disclosure for a specific failure or file action if the user needs it to fix something.

## Desktop Layout

Desktop uses one sidebar plus one main content area.

```text
Sidebar                             Main
-------------------------------------------------------------
Search                              Room header
Jobs / Activity                     Home | Files | Jobs | Status | Settings

Rooms                               Selected room dashboard or session
  Startup
    Pitch deck
    Market research
    LinkedIn outreach
  Personal
    Draft email
    Daily todo

Add room
Settings
```

The sidebar should be resizable or collapsible later, but the default should be readable.

## Mobile Layout

Mobile should not be a squeezed desktop.

Primary mobile screens:

- Rooms.
- Room dashboard.
- Session chat.
- Search.
- Jobs overview.
- Settings.

Suggested mobile navigation:

- Bottom nav: Rooms, Activity, Jobs, Files, Settings.
- Rooms screen shows expandable rooms and recent sessions.
- Tapping a room opens room dashboard.
- Tapping a session opens session chat.
- Room tabs are simple pills under the room header.
- Details use sheets, not side panels.

Mobile must support:

- Add room.
- Start a new session in a room.
- Continue a session.
- View files.
- Create or edit a job.
- Check status.
- Fix missing setup.
- Update room settings.

## Page And Surface Scope

### Login

Purpose: enter the private portal.

Elements:

- Agent Room wordmark.
- Email.
- Password.
- Sign in.
- Recovery hint for first Docker credentials.

No marketing hero. No runtime terminology.

States:

- Empty.
- Invalid credentials.
- Session expired.
- Rate limited.

### Onboarding

Purpose: get from first boot to first useful room.

Tone: a simple setup checklist.

Steps:

1. Sign in.
2. Add model provider.
3. Create first room.
4. Start first session.
5. Optional: add first job.

Do not show infrastructure internals. Show human checks:

- Portal ready.
- Model connected.
- Room ready.
- First session ready.

Provider setup:

- Provider.
- API key.
- Model.
- Test connection.

The test result should say:

- Connected.
- Could not connect.
- Invalid key.
- Model unavailable.

Room setup:

- Room name.
- What this room is for.
- Default provider.
- Basic instructions.

Optional first job:

- What should happen?
- When should it happen?

### Sidebar Rooms

Purpose: navigate rooms and sessions.

Room row should include:

- Room name.
- Expand/collapse affordance.
- Small state indicator.
- Attention badge only when needed.

Room row states:

- Ready.
- Working.
- Needs attention.
- Paused.

Session row should include:

- Session title.
- Last activity.
- State only when useful.

Session states:

- Working.
- Waiting.
- Done.
- Needs attention.

No metrics. No runtime details.

### Room Home

Purpose: answer what this room is and what it is doing.

Home content:

- Friendly room summary.
- Active sessions.
- Upcoming jobs.
- Recent outputs.
- Needs attention.
- Start new session.

Example copy:

```text
Startup is working on 3 things.
Pitch deck is still running.
Market research finished 12 minutes ago.
LinkedIn follow-ups run weekdays at 9 AM.
```

Primary actions:

- Start session.
- Add job.
- Upload file.
- Open settings.

Home should feel like a person or team-member page, not a dashboard.

### Session Chat

Purpose: talk to one room in one session.

Header:

- Room name.
- Session title.
- Session state.

Messages:

- Human messages.
- Assistant messages.
- Progress steps.
- File chips.
- Job origin if the session was created by a job.

Progress steps should be plain English:

- Searching the web.
- Reading uploaded files.
- Drafting the deck.
- Saving the file.
- Sending the message.

Each step can have:

- Done.
- Working.
- Failed.
- Needs approval.

Clicking a step opens a simple details sheet:

- What happened.
- What failed if relevant.
- How to fix it if relevant.

Do not show tool names by default.

Composer:

- Message box.
- Attach file.
- Send.
- Stop if a session is currently working and stop is supported.

### Files

Purpose: give the room a simple shared file area.

Files should feel closer to Drive or Slack files than a code editor.

Views:

- Recent.
- Uploads.
- Created by room.
- Folders if needed.

File cards or rows:

- Name.
- Type.
- Size where useful.
- Created or updated time.
- Source: uploaded, created by session, created by job.

Actions:

- Open preview.
- Download.
- Attach to session.
- Rename where safe.
- Move where safe.
- Delete only with confirmation.

Do not expose raw workspace trees as the default. If a raw tree is later needed, it should be intentionally hidden from the primary product flow.

### Jobs

Purpose: manage recurring or triggered room work.

Use "Jobs" in the UI, not "cron" as the primary label.

Job types:

- Scheduled job.
- Manual wake job.
- Inbound trigger job.

Job list:

- Name.
- Plain-language schedule.
- Enabled or paused.
- Last result.
- Next run.
- Needs attention.

Examples:

```text
Every weekday at 9 AM, send LinkedIn follow-ups.
Every morning, prepare my todo list.
Every Friday, summarize investor updates.
When a contact form arrives, draft a reply.
```

Create job flow:

- What should this room do?
- When or what should trigger it?
- Should it create a new session or continue an existing one, if supported?
- Save.

Advanced cron expressions are not part of the primary UI. If ever added, they belong behind Custom schedule.

### Status

Purpose: show whether the room can work.

Status should be human-level.

Show:

- Model connection: connected, disconnected, needs key.
- Jobs: running normally, last job failed, paused.
- Files: available, storage issue if any.
- Room setup: ready or missing setup.
- Last successful work.
- Last failed work.

Do not show:

- CPU.
- RAM.
- PID.
- Ports.
- Tokens.
- Config versions.
- Runtime file paths.
- Raw payloads.
- Gateway terminology.

Status should answer:

```text
Can this room work right now?
If not, what one thing do I need to fix?
```

### Settings

Purpose: configure the room.

Room settings:

- Room name.
- Room description.
- Instructions.
- Provider.
- Model.
- Room secrets.
- Connected tools.
- Job timezone.
- Pause or archive room.

App settings:

- Provider connections.
- Shared tools.
- Account.
- Theme.
- Security.
- Data/export if added.

Secret handling:

- Write-only after save.
- Masked after save.
- Replace or rotate explicitly.
- Never show plaintext again.

Settings should avoid duplicate places for the same setting. If provider is configured at app level and selected at room level, the UI must make that relationship clear.

### Activity

Purpose: give a simple global and room-level "what happened" feed.

Activity can be a top-level shortcut and a room home section.

Items:

- Session started.
- Session finished.
- Job ran.
- Job failed.
- File created.
- Provider needs attention.

Each item links to the room, session, file, job, or setting that matters.

Activity should not feel like logs.

### Search

Purpose: quickly find rooms, sessions, files, and jobs.

Search targets:

- Rooms.
- Sessions.
- Files.
- Jobs.
- Settings.

Search results should be grouped and plain-language.

## Interaction Rules

### Starting Work

New work starts inside a room.

Entry points:

- Room hover action: new session.
- Room dashboard: Start session.
- Empty room: Start first session.
- Mobile room screen: Start session button.

There is no global new chat.

### Running Work

When a session or job is working:

- Sidebar shows a subtle working indicator.
- Room home shows it under active sessions or active jobs.
- Session chat shows friendly progress steps.
- Mobile room list shows the room as working.

The app should not over-animate every active item.

### Attention And Failures

Attention should be visible but not scary.

Use plain copy:

- Needs API key.
- Job failed.
- File upload failed.
- Could not connect to model.
- Waiting for approval.

Every attention item needs:

- What happened.
- Why it matters.
- Fix button.

Example:

```text
Startup needs attention.
The model key is missing, so sessions and jobs cannot run.
Fix provider key.
```

### Technical Detail

Technical detail is not a normal product surface.

Allowed only when needed:

- A provider connection failed and the user needs the provider error.
- A file action failed and the user needs the filename.
- A job failed and the user needs the plain reason.

Not allowed in normal UI:

- Runtime ids.
- Ports.
- PIDs.
- Token versions.
- Raw JSON.
- Raw provider payloads.
- Internal paths.
- Runtime implementation branding.

## Visual Direction

The UI should be simple, soft, and confident.

Light theme:

- Warm neutral background.
- Clear dark text.
- Gentle borders.
- Calm green for ready.
- Amber for needs attention.
- Red only for blocking problems.

Dark theme:

- Soft charcoal background.
- Low-contrast panels.
- Clear readable text.
- Same semantic colors.

Component style:

- 8px radius maximum unless native components require otherwise.
- Dense enough to be useful.
- Large enough for normal people to understand.
- No marketing cards.
- No code-editor chrome.
- No terminal panels.
- No raw JSON blocks.
- No excessive status chips.

Typography:

- Clear body type.
- Friendly headings.
- No giant hero type in the app shell.
- No negative letter spacing.

Icons:

- Use familiar icons.
- Room, search, clock, file, settings, plus, warning, check.
- Icons support labels; they do not replace obvious text on mobile.

## Tailwind And shadcn Scope

Use Tailwind v4 and shadcn/ui as the component foundation.

Core components:

- App shell.
- Sidebar.
- Room group.
- Session row.
- Room dashboard header.
- Room tabs.
- Home summary.
- Session chat.
- Progress step.
- File card.
- Job row.
- Status card.
- Settings section.
- Secret field.
- Search command.
- Mobile sheet.
- Toast.
- Attention banner.

Reusable primitives should be added only when they remove real duplication.

## Suggested Routes

```text
/login
/onboarding
/
/activity
/jobs
/settings
/rooms/:roomId
/rooms/:roomId/files
/rooms/:roomId/jobs
/rooms/:roomId/status
/rooms/:roomId/settings
/rooms/:roomId/sessions/:sessionKey
```

The sidebar can remain visible for all authenticated desktop routes. Mobile can use separate screens and sheets.

## Acceptance Criteria

- The app brand is Agent Room, not the current runtime.
- The primary navigation is one sidebar.
- Rooms are expandable groups in the sidebar.
- Sessions appear under rooms.
- There is no top-level New chat.
- There is no second sidebar.
- Room dashboard has Home, Files, Jobs, Status, Settings.
- There is no Chats tab on the room dashboard.
- Session chat is opened from a session row under a room.
- Jobs are plain-language schedules and triggers, not cron-first UI.
- Status shows model connection, job state, setup state, and useful failures only.
- Runtime internals are not exposed in normal product UX.
- Files feel like a shared folder, not a code explorer.
- Mobile uses room list, room dashboard, and session chat screens rather than compressed desktop layout.
- Tool calls are friendly progress steps by default.
- Technical details appear only when needed to fix a user-visible issue.
- Settings do not duplicate the same concept in multiple places.
- Light and dark themes are complete.

## Mockup Set

The corrected mockups live in `plan/uiux-mockups/`.

Required new set:

- `desktop-light-sidebar-room-home.png`
- `desktop-dark-session-chat.png`
- `desktop-light-room-jobs.png`
- `desktop-dark-room-files.png`
- `desktop-light-onboarding-simple.png`
- `desktop-dark-settings-simple.png`
- `mobile-light-rooms.png`
- `mobile-dark-session.png`

The mockups are visual references only. This document is canonical.
