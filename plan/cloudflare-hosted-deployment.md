# Cloudflare Hosted Deployment

This document defines the Cloudflare hosted V1 deployment baseline for Agent Room while keeping the existing Docker self-hosted path local-first.

## Hosted Stack

- Control plane: Cloudflare Workers through the TanStack Start Cloudflare build path. Hosted health, Better Auth, billing, room, runtime, file, SSE, and cron routes use the D1/R2 hosted route/service layer while the existing Docker self-hosted path remains on the local Node/Bun runtime graph.
- Auth: Better Auth on the `AGENT_ROOM_DB` D1 binding with email/password, email verification, password reset, optional Google OAuth, and organization workspaces
- Database: D1 migrations under `apps/self-hosted/db/d1-migrations`
- Workspace storage: R2 object keys scoped by `workspace_id` and `room_id`
- Runtime: Cloudflare Containers through `AgentRoomRuntimeContainer`, reusing the existing Pi runtime entrypoint and runtime config/token contract
- Jobs: `AGENT_ROOM_RUNTIME_JOBS` queue binding for hosted runtime reconciliation work. The queue adapter verifies D1 runtime state and R2 object presence before starting the canonical room container.

## Cloudflare IaC

Hosted infrastructure lives in `apps/self-hosted/wrangler.hosted.jsonc`. Wrangler is the source of truth for:

- Worker name and entrypoint
- D1 binding and hosted D1 migration directory
- R2 workspace bucket binding
- Queue producer and consumer
- Durable Object binding for the runtime container
- Cloudflare Container image built from the root `Dockerfile.cloudflare-runtime`
- Required hosted secrets
- workers.dev route for pre-custom-domain smoke verification
- `app.openagentroom.com` custom domain routing for the production app Worker

The config intentionally omits Cloudflare resource IDs. Deployment scripts resolve the hosted D1 `database_id` from the target Cloudflare account into a temporary local config before running remote migrations or deploys. Do not add account-specific IDs, local generated config, or dashboard-exported secrets to the repo.

The hosted build emits `apps/self-hosted/dist/client` assets before deployment. The deployment helper uses the hosted Wrangler config with a temporary D1 ID overlay and passes required Worker secrets through a temporary secrets file so first deployment can create the Worker and set secrets in one upload.

The hosted runtime Container image is intentionally separate from the root self-hosted Dockerfile. It runs only the Pi runtime command from the `apps/self-hosted` workspace, copies the bundled runtime skills into production assets, and omits the web app build plus heavyweight document-rendering system packages so Cloudflare can accept the image under its hosted Container size limit. The root Dockerfile remains the full local self-hosted image.

The production workflow runs on pushes to `main` and manual dispatch. It bootstraps the production D1 database, R2 bucket, and queue if they are missing, applies D1 migrations, then deploys the same `agent-room-hosted` Worker that was used for workers.dev smoke verification. Cloudflare's native dashboard Git integration is not required; GitHub Actions is the deployment controller.

The PR preview workflow is intentionally separate. Privileged preview deployment is manual-only through `workflow_dispatch`, requires `CLOUDFLARE_HOSTED_PREVIEWS_ENABLED=true` and `CLOUDFLARE_WORKERS_SUBDOMAIN`, checks out the default branch first, resolves the PR through the GitHub API, refuses fork PRs, and then checks out the verified same-repository head SHA. Preview deploys create isolated resources named `agent-room-hosted-pr-<number>`, `agent-room-hosted-pr-<number>-workspaces`, and `agent-room-hosted-pr-<number>-runtime-jobs`. Preview Workers use their workers.dev URL and do not attach `app.openagentroom.com`. Cleanup on PR close uses preview-scoped Cloudflare credentials, checks out the repository default branch, refuses to delete any resource that does not match the preview naming pattern, then deletes the Worker, D1 database, queue, and an empty R2 bucket for same-repository PRs only.

## Required CI Secrets

The production deployment workflow requires these GitHub Actions secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `AGENT_ROOM_HOSTED_ENCRYPTION_KEY_B64`
- `AGENT_ROOM_EMAIL_WEBHOOK_URL`
- `AGENT_ROOM_EMAIL_WEBHOOK_BEARER_TOKEN`
- `AGENT_ROOM_EMAIL_FROM`
- `AGENT_ROOM_HOSTED_OPENROUTER_API_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_CREDIT_TOPUP_PRICE_ID`

`BETTER_AUTH_URL` must be the deployed hosted origin. `AGENT_ROOM_HOSTED_ENCRYPTION_KEY_B64` must be a base64-encoded 32-byte key used only for hosted R2 artifact and credential encryption. The hosted OpenRouter secret backs managed OpenRouter usage, and Stripe secrets are required for the production hosted billing mode. The email webhook URL must accept a bearer-authenticated Resend-compatible JSON payload with `from`, `to`, `subject`, `html`, and `text`, then return a 2xx response only after the provider accepts the message.

Optional Google OAuth requires both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. If either value is missing, Google sign-in is disabled rather than partially configured.

Manual preview deployment also needs these GitHub Actions repository variables:

- `CLOUDFLARE_HOSTED_PREVIEWS_ENABLED=true`
- `CLOUDFLARE_WORKERS_SUBDOMAIN`, for example the subdomain in `https://<worker>.<subdomain>.workers.dev`

Preview deployment uses preview-scoped GitHub Actions secrets with the `*_HOSTED_PREVIEW_*` names from `.github/workflows/cloudflare-hosted-preview.yml`. Do not point preview deploys at production Cloudflare, Better Auth, Stripe, email, OpenRouter, Brave, or encryption-key secrets.

## Commands

Build the hosted Worker:

```bash
bun run self-hosted:cloudflare:build
```

Generate Cloudflare binding types:

```bash
bun run self-hosted:cloudflare:typegen
```

Ensure the target Cloudflare D1 database, R2 bucket, and queue exist:

```bash
bun run self-hosted:cloudflare:resources
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
- Ensure the `agent-room-hosted` D1 database, `agent-room-hosted-runtime-jobs` queue, and `agent-room-hosted-workspaces` R2 bucket exist. The hosted resource script can create these once the relevant Cloudflare services are enabled.
- Add the required GitHub Actions secrets
- Set the preview repository variables and preview-scoped secrets if maintainers should be able to run manual PR previews
- Merge to `main` or run the `Cloudflare Hosted Deploy` workflow
- Confirm `/api/hosted/health` returns the expected D1, R2, queue, and runtime container binding truth on `https://app.openagentroom.com`
- Sign up with email/password, receive verification mail through the webhook, verify email, sign in, request a password reset, and verify the reset mail
- If Google OAuth is configured, sign in with Google OAuth and confirm the Better Auth user maps to an organization workspace
- Create a workspace-backed room and verify every persisted room, provider connection, MCP connection, runtime state, and usage event row carries the same `workspace_id`
- Enable Workers Paid before deploying Cloudflare Containers. Wrangler returns an account-level Containers authorization error until the target account has Workers Paid access.
- Start a hosted room runtime and verify the container receives only encrypted R2-backed runtime config/token materialization, not direct D1 credentials.
- Hydrate a workspace from R2, run a session, snapshot back to R2, stop on idle, and restart from the snapshot
- Verify hosted scheduled jobs remain disabled until the quota/runtime-lifecycle work lands separately
- Review Cloudflare Container isolation with untrusted multi-tenant code in the deployed account. If it does not meet the isolation bar, keep the runtime adapter path open for a stronger isolated runtime backend.

## Hosted V1 Baseline

The hosted V1 baseline covers these readiness points:

- Hosted runtime materialization uses encrypted R2 artifacts, canonical D1 runtime authority, queue-owned reconcile, compare-and-set version updates, and callback-authenticated state/file/usage sync.
- Hosted scheduled jobs remain disabled in this baseline; the runtime execution path does not install a Worker cron trigger or hosted job-run lease table.
- Stop and fail-closed paths destroy the container and clean runtime artifacts before clearing authority, with stopped desired-state written before cleanup so queued reconciles cannot restart a room during stop.
- Runtime state files, visible files, memory, and forked session state sync through canonical hosted callbacks before becoming visible in the hosted read model.
- Managed hosted OpenRouter is enabled through a room-scoped Worker proxy backed by exact runtime-correlated billing reservations and actual provider-returned `usage.cost` values; workspace BYOK and hosted Codex remain higher-priority explicit provider paths. Hosted rooms can still use stored workspace BYOK Brave credentials through the normal runtime materialization path.
- Hosted provider and HTTP MCP saves now validate through the hosted runtime materialization inputs before reporting `ready`; hosted MCP HTTP save-time validation runs the same DNS/private-network guard before the control-plane initialize fetch, and hosted MCP stdio is saved as invalid rather than selected for rooms because it cannot be safely validated through the hosted HTTP materialization path.
- Hosted billing credit, debit, and reservation accounting now keeps ledger evidence and account balances coupled through D1 batch writes; non-reservation debits spend only available balance, reservation-backed debits are tied to exact reservation ids, stale reservations expire before billing summaries, and included-credit expiry preserves cents backing active reservations.
- Hosted V1 owner-only workspace membership is represented directly in the baseline D1 auth schema.
- Worker runtime callbacks and managed provider proxies are split out of the Cloudflare Worker entrypoint, so `worker.ts` remains dispatch-focused while callback auth, file/state sync, usage billing, and OpenRouter proxy reservations live in the hosted runtime route module.
- Runtime, file cleanup, and upload failure logs avoid tenant, room, thread, job, and user-controlled path identifiers.
- The single-tenant Docker self-hosted path remains the local Node/Bun path and does not require hosted Cloudflare bindings or hosted secrets.
- Production duplication is verified at 0 clone groups/0 duplicated lines by the app quality score. The stricter non-generated sensitive scan still reports small repeated test/support snippets, so large touched files and test fakes remain maintainability debt under the godfile/spaghetti review lens rather than being treated as closed quality work.

## References

- Cloudflare Workers Wrangler configuration: https://developers.cloudflare.com/workers/wrangler/configuration/
- Cloudflare TanStack Start guide: https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/
- Cloudflare Containers guide: https://developers.cloudflare.com/containers/get-started/
- Cloudflare Containers and Workers bindings: https://developers.cloudflare.com/containers/platform-details/workers-connections/
- Better Auth D1 support: https://better-auth.com/blog/1-5
