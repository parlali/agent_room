# Agent Room

Agent Room is a self-hosted control room for persistent AI coworkers.

Each room has its own identity, files, memory, model connection, tools, scheduled jobs, runtime state, sessions, and audit trail. A room is meant to feel like a continuing collaborator, not a disposable chat tab.

## Status

Agent Room is early self-hosted software. It is designed for local or private-network use first. Treat it as an operator tool that can run commands, handle files, call model providers, store credentials, and schedule autonomous work.

Do not expose it directly to the public internet without a trusted reverse proxy, HTTPS, strong authentication, and backups.

## What You Get

- Room-first agent workspaces
- Persistent room memory
- Room-local files and generated artifacts
- Scheduled jobs
- Provider connections for OpenAI Codex OAuth, OpenRouter, Ollama, and LM Studio
- Built-in web search through a private SearXNG service
- Document, spreadsheet, presentation, PDF, and image workflows
- Runtime health, usage, and audit surfaces
- Docker-first deployment with generated first-boot credentials

## Requirements

For normal use:

- Docker
- Docker Compose

For local development:

- Bun
- Docker

## Quickstart

Start Agent Room:

```bash
docker compose up -d --build
```

Read the first-boot logs:

```bash
docker compose logs -f app
```

On first boot, Agent Room creates a root account and stores the generated credentials inside the app data volume. Recover them with:

```bash
docker compose exec app cat /app/.agent-room/system/bootstrap.json
```

Open the app:

```text
http://localhost:3000
```

Then complete onboarding:

- Sign in with the generated root credentials
- Connect a model provider
- Create a room
- Start the first session

## Docker Safety Defaults

The default Compose stack is intentionally local-first:

- The app binds to `127.0.0.1:3000` by default
- Postgres is not published to the host
- SearXNG is not published to the host
- Runtime data is stored in Docker volumes
- Root login credentials and encryption keys are generated on first boot unless you provide them

To change the local app port:

```bash
AGENT_ROOM_PORT=3100 docker compose up -d
```

To set stable deployment secrets before first boot, create a local `.env` file from `.env.example` and fill in the values you want to own:

```bash
cp .env.example .env
```

Keep `.env` private. It is ignored by git.

## Exposing Agent Room

For a home server or VPS, keep the app behind a reverse proxy such as Caddy, Traefik, or Nginx. The recommended shape is:

- Reverse proxy terminates HTTPS
- Reverse proxy forwards traffic to `127.0.0.1:3000`
- Postgres remains private on the Docker network
- SearXNG remains private on the Docker network
- Docker volumes are backed up

If you need Agent Room reachable from another machine on your LAN, bind the app port intentionally in `docker-compose.yml` or through a small override file. Do not publish Postgres.

## Updating

Pull the latest code and rebuild:

```bash
git pull
docker compose up -d --build
```

Database migrations run automatically when the app container starts.

## Backups

Back up both Docker volumes:

- `agent_room_agent-room-data`
- `agent_room_postgres-data`

The app data volume contains room runtime state, generated bootstrap credentials, provider runtime auth state, files, artifacts, logs, and room-local state. The Postgres volume contains application records and encrypted secret rows.

Before restoring to a new machine, make sure you also restore any deployment-owned environment values that were set before first boot, especially `AGENT_ROOM_ENCRYPTION_KEY_B64` if you provided one.

## Configuration

The Docker path works without required environment variables. These values are commonly customized:

| Variable                        | Purpose                                          | Default                   |
| ------------------------------- | ------------------------------------------------ | ------------------------- |
| `AGENT_ROOM_PORT`               | Host port for the web app                        | `3000`                    |
| `AGENT_ROOM_POSTGRES_PASSWORD`  | Internal Postgres password used by Compose       | `agent_room_local_only`   |
| `AGENT_ROOM_ENCRYPTION_KEY_B64` | Base64 32-byte encryption key for stored secrets | Generated on first boot   |
| `AGENT_ROOM_ROOT_EMAIL`         | Initial root email                               | Generated on first boot   |
| `AGENT_ROOM_ROOT_PASSWORD`      | Initial root password                            | Generated on first boot   |
| `AGENT_ROOM_SESSION_TTL_HOURS`  | Login session lifetime                           | `24`                      |
| `AGENT_ROOM_DATA_DIR`           | App data directory inside the container          | `/app/.agent-room`        |
| `AGENT_ROOM_SEARCH_SECRET`      | Private SearXNG secret used inside Compose       | `agent-room-local-search` |

## Development

Install dependencies:

```bash
bun install
```

Run checks:

```bash
bun run check
```

The normal product runtime is Docker-first:

```bash
docker compose up -d --build
```

Host watch mode is intentionally not the main path right now. The Docker stack is the canonical runtime path because it exercises the same database, runtime materialization, filesystem boundaries, and worker paths used by self-hosted deployments.

## Security Model

Agent Room treats the following areas as safety-critical:

- Authentication and session ownership
- Room isolation
- Provider binding
- Credential storage and materialization
- Runtime lifecycle
- Streaming and tool execution
- Scheduled jobs
- Auditability

Secrets should never be committed. Local runtime data, generated credentials, `.env`, `.agent-room`, logs, databases, Docker volumes, provider keys, and OAuth tokens are intentionally ignored.

Report security issues through the process in `SECURITY.md`.

## Contributing

Contributions are welcome while the project is still early. Read `CONTRIBUTING.md` before opening a pull request.

## License

Agent Room is released under the MIT License. See `LICENSE`.
