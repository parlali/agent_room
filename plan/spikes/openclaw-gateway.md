# OpenClaw Gateway Desk Spike

Date: 2026-04-21

Method: desk review only. No local install, no local runtime, no curls, no WebSocket session opened. This spike is meant to unblock product shape and Phase 0 decisions, not to claim live runtime validation.

Status note: this spike is historical context. Locked architecture after Phase 1 moved to an app-owned room execution-engine contract with per-room isolated runtime instances (OpenClaw as the first adapter), so shared-gateway assumptions here are superseded where they conflict.

## Sources Reviewed

- `openclaw/openclaw` docs:
    - `docs/concepts/multi-agent.md`
    - `docs/automation/cron-jobs.md`
    - `docs/gateway/protocol.md`
    - `docs/web/control-ui.md`
    - `docs/web/webchat.md`
- `openclaw/openclaw` code:
    - `src/gateway/hooks.ts`
    - `src/config/types.hooks.ts`
    - `src/cron/store.ts`
    - `src/gateway/server-methods/chat.ts`
    - `src/gateway/ws-log.ts`
    - `ui/src/ui/app-gateway.ts`
- `openclaw/openclaw` tests:
    - `src/gateway/server.hooks.test.ts`
    - `src/gateway/server-chat.agent-events.test.ts`
- Open issues:
    - `openclaw/openclaw#45086`
    - `openclaw/openclaw#32495`

## Findings

### 1. Multi-agent isolation is a first-class OpenClaw concept

The docs define an agent as an isolated unit with its own workspace, `agentDir`, auth profiles, and session store. The documented defaults are:

- workspace: `~/.openclaw/workspace` or `~/.openclaw/workspace-<agentId>`
- agent state: `~/.openclaw/agents/<agentId>/agent`
- sessions: `~/.openclaw/agents/<agentId>/sessions`

The docs are explicit that reusing `agentDir` across agents causes auth and session collisions. That is strong enough evidence that Agent Room should treat agent identity, workspace, memory, sessions, and triggers as OpenClaw-owned and agent-scoped, not as app-level abstractions.

### 2. Cron is per-job and can target a specific agent

Cron is owned by the Gateway and persists definitions in `~/.openclaw/cron/jobs.json`, with runtime state in `jobs-state.json`. The cron docs include explicit multi-agent examples using `--agent <id>`. `src/cron/store.ts` confirms the persisted split store path and runtime/state model.

Product implication: Agent Room can model cron ownership as an attribute of the OpenClaw job itself. There is no need for a second scheduler or an app-side mirror of scheduled work.

### 3. `/hooks/agent` supports explicit agent routing with bounded policy

The webhook docs expose `POST /hooks/agent` with bearer token auth and an `agentId` field. `src/gateway/hooks.ts` resolves the target agent through known agent ids and optional `hooks.allowedAgentIds`. `src/gateway/server.hooks.test.ts` covers:

- bearer or `x-openclaw-token` auth
- explicit agent routing
- deny/allow behavior for `allowedAgentIds`
- session-key rebinding into the target agent namespace

Product implication: inbound trigger ownership should stay explicit. Agent Room should expose hook target agent selection directly and fail closed when the Gateway denies the requested target.

### 4. One Gateway WebSocket can multiplex the room UI

The protocol docs define one Gateway WS control plane carrying requests, responses, and events. The Control UI docs say the bundled UI talks directly to the Gateway WebSocket. `ui/src/ui/app-gateway.ts` shows a single browser client handling `chat`, `agent`, `session.message`, `sessions.changed`, `cron`, and other events on the same connection.

`src/gateway/server-chat.agent-events.test.ts` shows `agent` event payloads carrying `sessionKey` and run metadata. `src/gateway/server-methods/chat.ts` and the protocol docs show `chat` events also carry `sessionKey`. This is enough to conclude that Agent Room can maintain one WS connection and multiplex rooms client-side by `sessionKey` and agent ownership rather than opening one connection per room.

What is still not proven here is real-world event volume, ordering edge cases under load, or whether we want one shared client instance or one per browser tab. That is a later implementation concern, not a Phase 0 blocker.

### 5. The bundled Control UI is still effectively pinned to the main agent

The user-reported issues are direct:

- `#32495` asks for switching between agents in Control UI and describes the UI as only connecting to the default `main` agent
- `#45086` asks for a WebChat agent/session switcher and explicitly says the current UI only connects to `agent:main:main`

The current client code also contains alias handling between `main` and `agent:main:main`, which matches the reported behavior. I did not reproduce it live, but the repo evidence is consistent with the issue reports.

Product implication: this is the wedge. Agent Room should not fork the Control UI to patch around this. It should build the room-first multi-agent surface directly against Gateway semantics.

## Product Conclusions

### Agent Room can trust OpenClaw enough to build against it directly

The reviewed docs, code, and tests are coherent on the important points:

- multi-agent identity and state isolation exist
- cron and hooks can target specific agents
- WS events expose enough session metadata to scope rooms
- the current bundled UI does not solve the multi-agent room problem

That is enough to proceed without standing up a competing runtime layer.

### The right UI default is a hybrid room

Because OpenClaw agents are both conversational and unattended, a pure chat default hides too much of the ongoing life of the agent, and a pure activity feed undercuts direct control. The room should open with:

- recent activity / runs / trigger outcomes visible by default
- thread list visible
- chat pane always present

This is a hybrid layout, biased toward recent unattended work rather than chat-first.

### Trigger configuration should be typed, not raw by default

OpenClaw’s trigger surface is explicit enough that Agent Room should start with typed forms for:

- cron
- generic webhooks
- channel bindings and channel-owned trigger routes

A raw JSON editor is useful only as an advanced escape hatch once there is a safe round-trip story. It should not be the primary UX.

### No UI database is needed for v0

Nothing in the reviewed Phase 0 material justifies a SQLite layer yet. The likely UI-local state can live in browser storage or URL state at first:

- selected room
- sidebar collapse/order
- transient filters

If a durable app-side store is added later, it should remain strictly UI-local.

### 2026-04-23 alignment update

This research note is superseded on one point: Agent Room no longer treats sandbox profiles as part of the product contract.

The locked product direction is:

- one canonical Dockerized Agent Room stack
- one dedicated OpenClaw runtime per room
- no host OpenClaw path in the product surface
- no NemoClaw surface in the product surface
- internal execution-engine modularity only, so OpenClaw can be replaced later without introducing runtime choices now

### Canonical deploy path should bundle vanilla OpenClaw first

The smallest reliable path for Agent Room is:

- `docker-compose`
- one bundled Agent Room service that includes OpenClaw
- one dedicated OpenClaw runtime per room started by Agent Room

Asking users to hand-install OpenClaw first adds avoidable friction and weakens the README promise.

## What To Steal, Not Copy

From OpenClaw:

- Gateway as source of truth
- agent/session/workspace semantics
- event stream and trigger ownership

From Mission Control:

- deploy clarity
- admin-grade status surfaces
- visible operational polish

From Clutch:

- strong real-time OpenClaw integration patterns
- proof that an OpenClaw-native UI is worth building

From ClawAgentHub:

- obvious workspace and status affordances

## Residual Risk

This spike does not replace a live smoke test. Before calling the room model validated in Phase 3, we should still do one real pass that confirms:

- event ordering is sane under a real multi-agent run
- session-to-agent mapping is stable in the payloads we actually consume
- cron, hooks, and room views line up cleanly in real data

That is validation work for later phases, not a reason to delay the product wedge.
