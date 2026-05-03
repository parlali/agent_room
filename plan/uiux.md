# Agent Room UI/UX Scope

Status: refined product direction for launch-readiness implementation.

## Product Definition

Agent Room is a private self-hosted portal for persistent AI coworkers.

Each room is a standalone coworker. It can:

- chat across many sessions
- remember room-local context
- search the web
- fetch URLs
- create and edit normal files
- generate images through configured providers
- run scheduled jobs
- show what it is doing
- show what it has produced
- show usage and cost

The UI should make that feel obvious to a normal operator. It should not feel like a runtime console, code editor, or model playground.

## User Mental Model

The user should think:

```text
I have a few AI coworkers.
Each coworker has its own memory, files, jobs, and capabilities.
I can talk to one coworker in many sessions.
I can ask it to make real documents and images.
I can let it run scheduled work.
I can see whether it is working, blocked, or finished.
```

The user should not need to think about:

```text
runtime ports
tokens
process ids
Pi state
provider payloads
tool JSON
MCP internals
Docker service names
```

## Information Architecture

```text
Agent Room
    Sidebar
        Rooms
            Sessions
    Top-level pages
        Activity
        Jobs
        Files
        Usage
        Settings
    Room pages
        Home
        Sessions
        Files
        Jobs
        Memory
        Capabilities
        Usage
        Status
        Settings
```

The sidebar is the primary navigation. Rooms are expandable groups. Sessions live under rooms.

There is no global new chat. New work starts inside a room.

## Core Navigation

### Sidebar

The sidebar shows:

- Search
- Activity
- Jobs
- Rooms
- Add room
- App settings
- User menu

Room rows show:

- room name
- expand/collapse
- subtle status dot
- attention badge only when needed

Session rows show:

- session title
- last activity
- working or attention state when useful

Do not put runtime metrics in the sidebar.

### Room Home

Room Home answers:

- who this coworker is
- what it is working on
- what needs attention
- what it produced recently
- what scheduled work is coming next

Primary actions:

- Start session
- Add job
- Upload file
- Open memory
- Open capabilities

Home should feel like a coworker page, not a dashboard of infrastructure.

### Session Chat

Session chat shows one conversation with one room.

Header:

- room name
- session title
- state: working, done, needs attention, paused
- stop button when active

Messages:

- user messages
- assistant messages
- progress steps
- files used
- artifacts created
- job origin when created by a job

Progress steps are plain language:

- Searching the web
- Fetching a page
- Reading the document
- Updating the spreadsheet
- Creating the deck
- Rendering the preview
- Saving the file
- Generating the image

Tool names and payloads are hidden by default. A details sheet can show technical context when useful.

## Files And Artifacts

Files should feel like a normal shared file area, closer to Drive or Slack files than a raw filesystem.

Default views:

- Recent
- Uploaded
- Created by room
- Documents
- Spreadsheets
- Presentations
- PDFs
- Images

File rows/cards show:

- name
- type
- preview thumbnail where available
- source: uploaded, session, job
- updated time
- size when useful

Actions:

- Preview
- Download
- Attach to session
- Edit with room
- Rename
- Delete with confirmation

Raw workspace trees should not be the default UI. They may exist behind an advanced workspace view if needed for development rooms.

## Office And PDF UX

Office and PDF actions should be normal product actions:

- Create Word document
- Edit Word document
- Create spreadsheet
- Edit spreadsheet
- Create presentation
- Edit presentation
- Export PDF
- Preview

The user should not see internal Markdown or JSON unless they ask for it.

When a room creates or edits an Office file, the UI should show:

- artifact name
- file type
- preview
- source session/job
- created or edited time
- download action
- verification state when available

Verification states:

- Preview rendered
- Exported successfully
- Needs attention
- Could not render preview

## Memory UX

Memory is room-local.

The room Memory page shows the canonical memory sections in normal language:

- Identity
- Operator
- Behavior
- Current Work
- Deadlines And Reminders
- Decisions
- Do Not Forget

The UI should not show raw JSON by default. Raw JSON can be available in an advanced drawer for troubleshooting or export/import.

Memory actions:

- Add memory item
- Edit item
- Delete item
- Mark reminder complete
- Set due date
- Set expiry date
- View source where available

The page should communicate that this memory belongs only to this room.

Memory status:

- Up to date
- Needs cleanup
- Over cap
- Invalid schema

If memory is invalid, the fix path should be clear and local to the room.

## Capabilities UX

Capabilities are default product features that can be configured or disabled.

Room Capabilities page:

- Web search
- URL fetch
- Documents
- Spreadsheets
- Presentations
- PDF
- Images
- MCP tools
- Shell/coding

Each capability shows:

- enabled state
- readiness
- provider/config status where needed
- last error where useful
- estimated cost warning where useful

Image capability includes:

- provider
- model
- key status
- default size/aspect ratio where useful
- enabled state

Search capability includes:

- backend: bundled search
- status
- test search action

Office/PDF capability includes:

- renderer available
- preview available
- supported formats

Do not make capabilities feel like a plugin marketplace in the first pass. They are product features with settings.

## Web Search UX

Search performed by the agent appears as progress and citations.

In chat:

- show "Searching the web" as a progress step
- show cited source chips in the answer when relevant
- allow opening source URLs

Search tool details can show:

- query
- result count
- source URLs
- fetch failures

Do not show raw SearXNG payloads.

## Jobs UX

Use "Jobs" in product UI, not "cron."

Job list shows:

- name
- plain-language schedule
- enabled or paused
- last result
- next run
- generated artifacts
- usage/cost when available
- needs attention state

Job detail shows:

- prompt
- schedule
- recent runs
- linked sessions
- output artifacts
- duration
- token/cost usage
- errors

Scheduled jobs are autonomous. The UI should not imply they are waiting for chat replies.

Create/edit job flow:

- What should this room do?
- When should it run?
- What should it produce?
- Should it save files?
- Enable or save paused

Advanced schedules can come later. The primary UI should use plain presets and human-readable timing.

## Usage UX

Usage is first-class.

App Usage page:

- total usage by date range
- usage by room
- usage by provider
- usage by model
- estimated cost
- unknown usage count

Room Usage page:

- session usage
- job usage
- tool usage
- document/image usage
- provider/model breakdown

Session and job rows can show small usage summaries when useful, but usage should not overwhelm normal work views.

Unknown cost or tokens should be shown explicitly:

```text
Usage unavailable from provider
```

Do not fabricate estimates when the source data is missing.

## Status UX

Room Status answers:

```text
Can this room work right now?
If not, what one thing needs fixing?
```

Show:

- model connection
- search readiness
- document capability readiness
- image provider readiness
- job health
- file storage health
- last successful work
- last failed work

Hide by default:

- PID
- port
- runtime token
- internal paths
- raw payloads
- config versions

Technical details belong behind a disclosure when they help fix a problem.

## Settings UX

Room settings:

- room name
- room description
- room instructions
- provider
- model
- secrets
- timezone
- pause/archive

App settings:

- provider connections
- image providers
- capability defaults
- MCP connections
- account
- security
- theme
- data/export

Secrets:

- write-only after save
- masked after save
- rotate explicitly
- never show plaintext again

## Onboarding

First boot should get the operator to a useful first room.

Steps:

1. Sign in.
2. Add model provider.
3. Confirm bundled search is ready.
4. Create first room.
5. Start first session.
6. Optional: configure image provider.
7. Optional: create first job.

Provider test copy should be plain:

- Connected
- Invalid key
- Model unavailable
- Could not connect

Search readiness should be plain:

- Search ready
- Search service unavailable

## Activity

Activity is not logs.

Activity items:

- Session started
- Session finished
- Job ran
- Job failed
- File created
- File edited
- Image generated
- Memory updated
- Capability needs attention

Each item links to the relevant room, session, file, job, memory item, or setting.

## Mobile UX

Mobile is a first-class surface.

Primary mobile screens:

- Rooms
- Activity
- Jobs
- Files
- Usage
- Settings

Room pages use top headers and compact tabs. Details use sheets. The app should support:

- start a session
- continue a session
- check progress
- preview/download files
- create/edit a job
- update memory
- configure a capability
- check usage
- fix provider or capability issues

Mobile should not expose raw runtime detail.

## Visual Direction

The UI should feel calm, capable, private, and work-focused.

Use:

- restrained neutral backgrounds
- clear text
- subtle borders
- semantic status colors
- familiar icons
- compact but readable layout

Avoid:

- marketing hero layouts inside the app
- terminal-style panels
- raw JSON blocks in primary UI
- oversized status cards
- runtime branding
- code-editor chrome
- gratuitous animations

Cards are for repeated items, modals, and framed tools. Page sections should not be nested cards.

## Component Scope

Core components:

- app shell
- sidebar
- room row
- session row
- room header
- room tabs
- home activity summary
- session chat
- progress step
- artifact card
- artifact preview
- job row
- job detail
- memory section editor
- capability row
- usage chart/table
- status banner
- settings section
- secret field
- search command
- mobile sheet
- toast

Reusable primitives should be added only when they remove real duplication.

## Route Direction

```text
/login
/onboarding
/
/activity
/jobs
/files
/usage
/settings
/rooms/:roomId
/rooms/:roomId/sessions
/rooms/:roomId/files
/rooms/:roomId/jobs
/rooms/:roomId/memory
/rooms/:roomId/capabilities
/rooms/:roomId/usage
/rooms/:roomId/status
/rooms/:roomId/settings
/rooms/:roomId/sessions/:sessionKey
```

Routes can be consolidated if implementation shows a simpler structure, but the product concepts should remain clear.
