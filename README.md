# Agent Room

Agent Room is a room-first operator UI for persistent OpenClaw agents.

The thesis is simple: the agent is a colleague, not a session.

Each agent gets a room with its own identity, workspace, memory, triggers, and ongoing life. You can chat with it when needed, but the room is not just a chat thread. It is the operational surface for an always-on agent that can wake on cron, inbound hooks, email, or channel events and continue work when no human is watching.

Each session inside a room is just a chat with that same room brain. Sessions can run in parallel, but they do not create new agent identities or share a second control-plane source of truth.

OpenClaw is the only runtime engine shipped today. The engine boundary stays internal so Agent Room can replace OpenClaw later without rewriting the room UX.

## What This Is

Agent Room is an OSS, self-hosted UI for managing many persistent OpenClaw agents from one place.

The intended shape is:

- One operator UI
- Many persistent agents
- One room per agent
- One dedicated OpenClaw runtime per room
- Many sessions per room, all talking to that one room brain
- one internal execution-engine contract with OpenClaw as the only shipped implementation and source of truth
- No reimplementation of agent execution, memory, scheduler, tools, or transport

This is not a framework for building agent loops. It is not a generic multi-runtime control plane. It is a focused product for people who want OpenClaw-backed agents to feel like durable coworkers rather than disposable sessions.

## Why Now

The infrastructure is finally here:

- OpenClaw already gives us persistent agents, isolated workspaces, memory files, triggers, channels, HTTP hooks, and a Gateway API over HTTP and WebSocket
- Model access is now good enough across providers that an operator UI does not need to be vendor-specific
- Self-hosted users increasingly want agent operations without giving up runtime control or local state ownership

The missing piece is the product layer:

- a clear pitch
- a room-first UI
- an easy local deploy

## Product Shape

The primary object in Agent Room is the room, not the task board.

Each room should make it obvious:

- who the agent is
- what it has been doing
- what triggered it recently
- which threads exist with that agent
- what is in its memory and workspace
- whether it is idle, running, blocked, or errored

The default experience should feel like opening a colleague's office, not opening a generic orchestration console.

## What OpenClaw Owns

OpenClaw remains the source of truth for:

- agent runtime and execution
- sessions and event streams
- per-agent workspace
- per-agent memory and identity files
- cron jobs and trigger transport
- tools, channels, and provider integrations

Agent Room should not duplicate or shadow those concerns into a parallel application model unless something is clearly UI-local.

## What Agent Room Owns

Agent Room should own:

- room-first navigation and layout
- multi-agent operator workflow
- per-room visibility across chat sessions, runs, triggers, memory, and workspace
- a coherent deploy story for local self-hosting
- a product opinionated enough that the system feels usable on day one

## Why Not Just Use Existing Projects

There are adjacent OSS projects here already. The claim is not that nothing exists. The claim is that the exact room-first OpenClaw product shape still looks underbuilt.

### Mission Control

Mission Control is the strongest adjacent project. It already covers real agent operations concerns: fleet visibility, task orchestration, recurring jobs, monitoring, cost tracking, auditability, and multiple runtime adapters.

Why it does not eliminate this project:

- it is control-plane first, not room-first
- it centers tasks, workflows, and governance more than per-agent identity/workspace/memory
- it introduces a broader multi-framework abstraction layer, while Agent Room wants OpenClaw to stay the explicit source of truth

What to steal:

- deploy clarity
- observability surfaces
- admin-grade polish around status, logs, and guardrails

### Clutch

Clutch is a real OpenClaw UI, especially for software-delivery workflows. It includes chat, work loops, sessions, GitHub integration, and reactive state.

Why it does not eliminate this project:

- it is software-delivery and work-loop shaped
- it reads more like an autonomous dev team console than a general room-first operator UI for persistent colleagues
- it persists a broader orchestration model in Convex, while Agent Room should stay much closer to OpenClaw truth

What to steal:

- sharp OpenClaw integration patterns
- real-time session UX
- proof that an OpenClaw-native UI is worth building

### ClawAgentHub

ClawAgentHub is useful evidence that people want a dashboard around OpenClaw, but it looks more like a workspace and ticket-flow system than the product we want.

Why it does not eliminate this project:

- it is board and status shaped
- it is less convincing as a production-grade operator surface
- it does not appear to push the room metaphor to the center

What to steal:

- any simple concepts that reduce setup friction
- anything visually clear in multi-agent status presentation

## Principles

- The agent is a colleague, not a session
- OpenClaw owns runtime and state
- Agent Room owns UX
- Single source of truth beats convenience copies
- Keep one canonical room execution-engine contract so the backend engine can be replaced without rewriting the room UX
- Start narrow, useful, and easy to deploy

## What v0 Must Prove

Before the product is real, v0 should prove:

- multiple room brains feel natural in one UI
- each room brain is understandable at a glance
- real OpenClaw events and state can drive the UI directly
- basic session chat, activity, triggers, and run visibility are enough to make the system feel obviously useful
- local setup is simple enough that the README pitch survives first contact

## Canonical Local Path

There is one canonical deploy path for this stage:

- one Docker Compose stack
- Postgres and Agent Room in the same stack
- OpenClaw bundled into the Agent Room image (pinned Docker build version)
- one dedicated bundled OpenClaw runtime per room
- no host-level OpenClaw prerequisite
- no sandbox choice in the product surface
- no required `.env` values for first boot

## Local Quickstart

1. Start the full stack:

```bash
docker compose up -d --build
```

No local OpenClaw install or env bootstrap is required for this path.

2. Read first-boot logs:

```bash
docker compose logs -f app
```

On first boot, Agent Room generates and persists bootstrap secrets and root login credentials if not explicitly provided.

If you need to recover the generated credentials later, run:

```bash
docker compose exec app cat /app/.agent-room/system/bootstrap.json
```

Use the persisted `rootEmail` and `rootPassword` values from that file.

3. Open the app:

```bash
http://localhost:3000
```

4. Complete first-room onboarding in the UI:

- sign in with the generated root credentials
- create the first room
- open the room immediately after provisioning

## Local Development Status

Host watch-mode (`bun run dev`) is intentionally disabled right now to keep one canonical runtime path.

For this stage, run Agent Room through Docker only:

```bash
docker compose up -d --build
```

A dedicated development workflow script will be added later to run required Docker services plus a separate TanStack watch process.

## Environment Contract (Fail-Closed)

For the canonical Docker path, no env vars are required. Agent Room starts with defaults and fails closed only on invalid runtime config.

- `DATABASE_URL` defaults to local Postgres with `sslmode=disable` and is set in `docker-compose.yml` for the canonical stack
- `AGENT_ROOM_ENCRYPTION_KEY_B64` is optional; when omitted, Agent Room generates and persists a 32-byte key on first boot
- `AGENT_ROOM_ROOT_EMAIL` is optional; when omitted, Agent Room generates and persists a default root email on first boot
- `AGENT_ROOM_ROOT_PASSWORD` is optional; when omitted, Agent Room generates and persists a root password on first boot
- `AGENT_ROOM_SESSION_TTL_HOURS` defaults to `24`
- OpenClaw is bundled and started internally for each room in the canonical stack

Filesystem and mount expectations:

- `AGENT_ROOM_DATA_DIR` must be writable and persisted (default `.agent-room` locally, `/app/.agent-room` in Docker)
- Postgres persistence uses the `postgres-data` Docker volume from `docker-compose.yml`
- Agent Room runtime/bootstrap persistence uses the `agent-room-data` Docker volume from `docker-compose.yml`
