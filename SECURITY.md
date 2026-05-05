# Security Policy

Agent Room can store credentials, run tools, execute scheduled work, read and write files, and call model providers. Please report security issues privately first.

## Supported Versions

Agent Room is currently pre-1.0. Security fixes are handled on the main branch.

## Reporting A Vulnerability

Do not open a public issue for a suspected vulnerability.

Contact the maintainer directly through the GitHub profile attached to this repository and include:

- A short summary
- Affected version or commit
- Reproduction steps
- Impact
- Whether credentials, room isolation, provider binding, runtime state, or persisted data are involved

Please do not include real provider keys, OAuth tokens, generated root credentials, database dumps, or private room data in the first report. If sensitive evidence is necessary, coordinate a safer transfer path first.

## Scope

High-priority reports include:

- Authentication bypass
- Session ownership bugs
- Cross-room data access
- Secret exposure in UI, logs, files, tool output, audit events, or runtime state
- Provider credential leakage or provider binding confusion
- Unsafe runtime materialization
- Command or tool execution outside room boundaries
- SSRF or unsafe URL fetch behavior
- Scheduled job duplication or execution under the wrong room
- Unauthorized MCP tool access

## Deployment Notes

The default Docker Compose stack is local-first. Do not expose Agent Room directly to the public internet without:

- HTTPS
- A trusted reverse proxy
- Strong root credentials
- Private Postgres and SearXNG services
- Backups
- A plan for rotating provider credentials

Never commit `.env`, `.agent-room`, generated bootstrap credentials, provider keys, OAuth tokens, logs, databases, or Docker volumes.
