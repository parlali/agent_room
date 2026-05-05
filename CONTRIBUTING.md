# Contributing

Thanks for helping improve Agent Room.

Agent Room is self-hosted agent orchestration software. Correctness, isolation, auditability, credential safety, and runtime/provider truth matter more than convenience.

## Before You Start

- Open an issue for substantial behavior changes.
- Keep pull requests focused.
- Do not include local runtime data, real credentials, generated bootstrap files, logs, databases, Docker volumes, provider keys, OAuth tokens, or personal machine paths.
- Update documentation when behavior, setup, configuration, or security expectations change.

## Development Setup

Install dependencies:

```bash
bun install
```

Run the Docker stack:

```bash
docker compose up -d --build
```

Run the full local check:

```bash
bun run check
```

## Code Style

- Use TypeScript.
- Use Bun for commands.
- Use 4 spaces for indentation.
- Avoid optional semicolons.
- Avoid inline comments unless they are truly necessary.
- Prefer existing patterns and shared canonical types.
- Do not duplicate logic or create multiple sources of truth.

## Safety-Critical Areas

Treat changes in these areas as high risk:

- Authentication
- Session ownership
- Room isolation
- Secret handling
- Provider binding
- Runtime configuration
- Runtime lifecycle
- Tool execution
- Streaming
- Scheduled jobs
- Audit logging

For runtime bugs, trace the full path from UI action to route or server function, service, adapter, runtime wrapper, persisted state, and dashboard/read model.

## Tests

Tests should cover the real failure mode whenever possible. Good sources are:

- Logs
- Exported runtime state
- Browser-visible behavior
- Persisted state
- Provider validation behavior
- Runtime materialization output

Connection tests should exercise the same runtime config, credentials, provider path, and materialization path used by rooms and scheduled jobs.

## Pull Requests

A good pull request includes:

- A short explanation of the problem
- A focused description of the fix
- Tests or a clear explanation of why tests are not practical
- Any documentation updates required by the behavior change
- Notes about direct and downstream verification

Before opening a pull request, run:

```bash
bun run check
```
