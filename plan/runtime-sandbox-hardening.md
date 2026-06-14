# Pi Runtime Sandbox Hardening (Issue #32)

Audit and hardening of the per-room Pi runtime isolation boundary so hosted,
multi-tenant deployments can safely run agent tools that execute commands and
reach the network. All changes are portable and configurable so self-hosted
operators keep control of local policy.

## Effective Isolation Boundary Today

Materialization path traced UI/route -> service -> adapter -> runtime wrapper ->
persisted state:

- `rooms/runtime-materializer.ts` builds one room root per room under
  `${AGENT_ROOM_DATA_DIR}/rooms/${roomFilesystemId(roomId)}`. Room ids are
  hashed into opaque filesystem ids (`rooms/room-filesystem-id.ts`) and validated
  against a strict character set, so room ids cannot traverse paths.
- Each writable room is assigned a dedicated, deterministic OS identity
  (`rooms/runtime-sandbox-identity.ts`): a system user `ar-<hash>` with a
  per-room uid/gid. Creation requires root and fails closed otherwise.
- Filesystem ownership and modes (`rooms/runtime-sandbox-filesystem.ts`,
  `rooms/runtime-file-ownership.ts`) keep `runtime/`, secrets, config, token, and
  metadata backend-owned (0o700/0o600), and chown only `workspace/`, `store/`,
  `home/`, and `tmp/` to the per-room user.
- Agent tool execution drops privileges: shell commands
  (`pi-runtime/background-commands.ts`) and the document worker
  (`pi-runtime/document-tools/worker.ts`) are wrapped with
  `setpriv --reuid --regid --clear-groups --no-new-privs`
  (`rooms/runtime-sandbox-command.ts`), spawned detached as their own process
  group, with a per-command wall-clock timeout (SIGTERM then SIGKILL), full
  process-group kill, and 128 KB output caps.
- Writable-path access is constrained to the four shell-writable roots and
  validated component by component, rejecting symlinks and `..` escapes
  (`rooms/sandbox-owned-paths.ts`, `security/path-boundary.ts`,
  `pi-runtime/room-visible-paths.ts`). The managed `fetch_url` path enforces
  strong SSRF protection, including DNS resolution checks and per-redirect
  re-validation (`pi-runtime/web-url-safety.ts`, `pi-runtime/web-fetch.ts`).
- Child process environments are an allowlist, not an inheritance
  (`security/process-env.ts`): only `PATH`, `LANG`, `LC_ALL`, `TZ`, `BUN_INSTALL`
  are forwarded from the parent, and a reserved-key denylist prevents room config
  from shadowing operator keys. Operator secrets (database URL, encryption key,
  installation tokens) are therefore never forwarded by default.

## Verified Gaps

1. No OS-level resource limits on sandboxed tool processes. The per-command
   wall-clock timeout bounds duration, but nothing bounds process count (fork
   bombs), file size (disk fill), CPU, or memory within that window, and core
   dumps were allowed.
2. Managed HTTP MCP servers were connected without URL validation
   (`pi-runtime/mcp-bridge.ts`), so an HTTP MCP server URL could target
   localhost, private ranges, or the cloud metadata endpoint.
3. Shell tools can still reach arbitrary outbound network destinations (for
   example `curl`), because there is no OS/container egress policy. This is the
   network-egress side of hosted hardening and is owned by issue #33; it is noted
   here as a residual, not closed in this change.

The audit-reported "intermediate symlink escape" in `sandbox-owned-paths.ts` was
not reproduced: the directory walk validates each path component and rejects
symlinks, so it is not a gap.

## Changes In This Pass

- Added a typed, canonical `RuntimeSandboxHardening` policy
  (`domain/domain-types.ts`) carried on `PiRuntimeConfig` and resolved once,
  backend-side, from deployment env (`config/env.ts`,
  `rooms/runtime-sandbox-hardening.ts`). The runtime reads policy from its config
  only; it cannot set or raise its own limits.
- Enforced OS resource limits via `prlimit` wrapping `setpriv` for per-room
  commands (`rooms/runtime-sandbox-command.ts`). Core dumps are always disabled;
  process count, open files, file size, CPU seconds, and address space are
  configurable. `prlimit` ships with `setpriv` in `util-linux`, already required
  by the runtime image.
- Blocked private-network HTTP MCP egress when restricted egress is enabled
  (`pi-runtime/mcp-bridge.ts`), reusing the existing `assertSafeUrl` SSRF guard
  and failing closed.
- Pinned the env allowlist behavior with a regression test so future operator
  secrets (for example Supabase or Stripe keys for issues #30/#31) are never
  forwarded to room runtimes (`security/process-env.test.ts`).

## Defaults And Configuration

Defaults preserve existing self-hosted behavior while removing the cheapest
abuse vectors:

- `AGENT_ROOM_RUNTIME_MAX_PROCESSES` defaults to 8192 (fork-bomb guard); set 0 to
  disable.
- `AGENT_ROOM_RUNTIME_MAX_OPEN_FILES`, `_MAX_FILE_SIZE_BYTES`, `_MAX_CPU_SECONDS`,
  `_MAX_ADDRESS_SPACE_BYTES` are opt-in (unset means unlimited).
- `AGENT_ROOM_RUNTIME_RESTRICT_PRIVATE_NETWORK` defaults to false so self-hosted
  localhost MCP servers keep working; hosted should set it true.

Connection validation uses the same resolved policy as real rooms
(`configuration/provider-connection-validation.ts`).

## Residuals (Out Of Scope Here)

- The Pi runtime process itself runs as the backend (root) user; only agent tool
  execution drops privileges. Running the whole runtime non-root or in a
  per-tenant container is a larger architectural change tracked alongside the
  hosted deployment work (#31) and deeper sandboxing options.
- OS/container network egress restriction for shell tools (blocking direct
  `curl`/`wget`/package-manager network access) is owned by issue #33.
- Quotas, concurrency caps, and kill switches are owned by issue #34.
