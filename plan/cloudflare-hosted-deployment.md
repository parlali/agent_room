# Cloudflare Hosted Deployment

Issue 31 adds an explicit hosted deployment path for Agent Room on Cloudflare while keeping the existing Docker self-hosted path local-first.

## Hosted Stack

- Control plane: Cloudflare Workers through the TanStack Start Cloudflare build path
- Auth: Better Auth on the `AGENT_ROOM_DB` D1 binding with email/password, email verification, password reset, Google OAuth, and organization workspaces
- Database: D1 migrations under `apps/self-hosted/db/d1-migrations`
- Workspace storage: R2 object keys scoped by `workspace_id` and `room_id`
- Runtime: Cloudflare Containers through `AgentRoomRuntimeContainer`, reusing the existing Pi runtime entrypoint and runtime config/token contract
- Jobs: `AGENT_ROOM_RUNTIME_JOBS` queue binding for hosted runtime reconciliation work

## Cloudflare IaC

Hosted infrastructure lives in `apps/self-hosted/wrangler.hosted.jsonc`. Wrangler is the source of truth for:

- Worker name and entrypoint
- D1 binding and hosted D1 migration directory
- R2 workspace bucket binding
- Queue producer and consumer
- Durable Object binding for the runtime container
- Cloudflare Container image built from the root Dockerfile
- Required hosted secrets

The config intentionally omits Cloudflare resource IDs so Wrangler can provision supported resources from IaC. Do not add account-specific IDs, local generated config, or dashboard-exported secrets to the repo.

The hosted build emits `apps/self-hosted/dist/server/wrangler.json`, and deployment uses that generated config. Do not deploy `wrangler.hosted.jsonc` directly: Vite must first resolve TanStack Start virtual modules and merge the hosted Worker entry into the built Worker bundle.

## Required CI Secrets

The manual deployment workflow requires these GitHub Actions secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `AGENT_ROOM_EMAIL_WEBHOOK_URL`
- `AGENT_ROOM_EMAIL_WEBHOOK_BEARER_TOKEN`
- `AGENT_ROOM_EMAIL_FROM`

`BETTER_AUTH_URL` must be the deployed hosted origin. The email webhook must accept a bearer-authenticated JSON payload and return a 2xx response only after the provider accepts the message.

## Commands

Build the hosted Worker:

```bash
bun run self-hosted:cloudflare:build
```

Generate Cloudflare binding types:

```bash
bun run self-hosted:cloudflare:typegen
```

Apply remote D1 migrations:

```bash
bun run self-hosted:cloudflare:d1:migrate
```

Deploy:

```bash
bun run self-hosted:cloudflare:deploy
```

## Remaining Verification

These steps require real deployment credentials and cannot be completed in the public repo:

- Enable Workers Paid, R2, D1, Queues, and Containers on the target Cloudflare account
- Add the required GitHub Actions secrets
- Run the `Cloudflare Hosted Deploy` workflow
- Confirm `/api/hosted/health` returns the expected D1, R2, queue, and runtime container binding truth
- Sign up with email/password, receive verification mail through the webhook, verify email, sign in, request a password reset, and verify the reset mail
- Sign in with Google OAuth and confirm the Better Auth user maps to an organization workspace
- Create a workspace-backed room and verify every persisted room, provider connection, MCP connection, job, runtime state, and usage event row carries the same `workspace_id`
- Start a hosted room runtime and verify the container receives only runtime config/token materialization, not direct D1 credentials
- Hydrate a workspace from R2, run a session, snapshot back to R2, stop on idle, and restart from the snapshot
- Run scheduled jobs through the queue path and verify usage and audit rows remain workspace-scoped
- Review Cloudflare Container isolation with untrusted multi-tenant code in the deployed account. If it does not meet the isolation bar, keep the runtime adapter path open for a stronger isolated runtime backend.

## References

- Cloudflare Workers Wrangler configuration: https://developers.cloudflare.com/workers/wrangler/configuration/
- Cloudflare TanStack Start guide: https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/
- Cloudflare Containers guide: https://developers.cloudflare.com/containers/get-started/
- Cloudflare Containers and Workers bindings: https://developers.cloudflare.com/containers/platform-details/workers-connections/
- Better Auth D1 support: https://better-auth.com/blog/1-5
