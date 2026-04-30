# Agent Room

Agent Room is a self-hosted room-first operator UI for persistent autonomous agents.

The thesis is simple: the agent is a colleague, not a disposable chat session.

Each room has its own identity, workspace, provider binding, runtime state, jobs, files, MCP bindings, and audit surface. Sessions inside a room talk to that same room brain. They can run in parallel, but they do not create a second control plane.

## Runtime

Agent Room ships an app-owned per-room runtime wrapper built on Pi.

The ownership split is:

- Agent Room owns rooms, lifecycle, provider truth, credential boundaries, MCP configuration, jobs, audit, files, UI read models, and deployment.
- Pi owns the agent kernel: model calls, transcripts, streaming events, abort, compaction primitives, provider registry hooks, auth storage primitives, and tool execution hooks.
- The browser and server routes talk to Agent Room's runtime-neutral room execution contract, not to Pi directly.

The canonical provider scope for this migration is OpenAI Codex OAuth, OpenRouter, Ollama, and LM Studio. Codex OAuth is room-scoped and stores tokens under the room data root.

## Product Shape

The primary object is the room, not a task board.

Each room should make it clear:

- who the agent is
- what it has been doing
- which threads exist
- what model and provider are bound
- what files, jobs, and MCP connections are available
- whether the room is idle, running, blocked, or errored

## Local Quickstart

Start the full stack:

```bash
docker compose up -d --build
```

Read first-boot logs:

```bash
docker compose logs -f app
```

On first boot, Agent Room generates and persists bootstrap secrets and root login credentials if not explicitly provided.

Recover generated credentials:

```bash
docker compose exec app cat /app/.agent-room/system/bootstrap.json
```

Open the app:

```bash
http://localhost:3000
```

Complete onboarding in the UI:

- sign in with the generated root credentials
- configure a supported provider
- create the first room
- open the room immediately after provisioning

## Local Development Status

Host watch-mode (`bun run dev`) is intentionally disabled right now to keep one canonical runtime path.

For this stage, run Agent Room through Docker:

```bash
docker compose up -d --build
```

## Environment Contract

For the canonical Docker path, no env vars are required. Agent Room starts with defaults and fails closed on invalid runtime configuration.

- `DATABASE_URL` defaults to local Postgres with `sslmode=disable` and is set in `docker-compose.yml`
- `AGENT_ROOM_ENCRYPTION_KEY_B64` is optional; when omitted, Agent Room generates and persists a 32-byte key on first boot
- `AGENT_ROOM_ROOT_EMAIL` is optional; when omitted, Agent Room generates and persists a default root email on first boot
- `AGENT_ROOM_ROOT_PASSWORD` is optional; when omitted, Agent Room generates and persists a root password on first boot
- `AGENT_ROOM_SESSION_TTL_HOURS` defaults to `24`
- `AGENT_ROOM_DATA_DIR` must be writable and persisted

Filesystem and mount expectations:

- Postgres persistence uses the `postgres-data` Docker volume
- Agent Room runtime and bootstrap persistence uses the `agent-room-data` Docker volume
- Room runtime state, auth, sessions, logs, workspace, and store data stay under the Agent Room data root
