# Agent Room — Context

## What this is

An OSS, self-hosted room-first operator UI. One operator UI manages many persistent room runtimes through a room-scoped execution-engine contract. OpenClaw is the only shipped engine implementation today. Each agent is a room: a colleague with its own identity, workspace, memory, and triggers. Chat with it, or let it work unattended through cron, inbound email, webhooks, or channel messages. Sessions are parallel chats inside that same room brain, not separate agents.

Human analogy: the agent is a colleague at the company, not a session. Threads are separate conversations with that colleague. They remember across threads and keep consistent skills, but each conversation stays scoped to its topic. On top of that, the colleague has a job that happens whether or not you are talking to them — their inbox, their schedule, their webhooks.

Closest analogs, all closed / cloud / vendor-locked:

- Anthropic Claude Managed Agents (launched 2026-04-08) — Claude-only, hosted.
- Microsoft Agent 365 (GA 2026-05-01) — Microsoft ecosystem, $15/user/month.
- Salesforce Agent Fabric (GA 2026-06) — enterprise, closed.

The OSS, model-agnostic equivalent does not exist as of April 2026.

## Why the gap exists now

Three things had to land simultaneously, and they only just did:

1. An OSS runtime with real code + shell + memory + triggers + multi-agent persistence. OpenClaw (15k stars, MIT) is the first that clears the daily-driver bar.
2. Stable model-agnostic inference across providers. 2025 settled this.
3. Cheap, reliable per-room runtime isolation in a self-hosted stack.

The pieces exist. No one has shipped the operator UI on top.

## Why not just use X

- **Anthropic Managed Agents / Microsoft Agent 365 / Salesforce Agent Fabric** — closed, vendor-locked, single-model or enterprise-only.
- **LibreChat / LobeChat** — chat-with-tools. No real shell / FS. LibreChat caps iteration at 25 steps by default. Not operator-shaped.
- **Agent Zero** — framework-shaped (one primary spawns subordinates). Not N independent colleagues.
- **Hermes Agent** — single persistent agent.
- **Mission Control (builderz-labs)** — admin-heavy control plane with strong deploy and observability ideas, but still task-board and adapter-layer shaped.
- **CrewAI / AutoGen / LangGraph** — frameworks, not UIs.
- **OpenClaw's own Control UI** — bundled on `:18789`, still effectively main-agent-first. Open issues `#45086` and `#32495` confirm the missing multi-agent chat switcher.

## What OpenClaw already provides

Verified April 2026 against docs.openclaw.ai:

- **Multi-agent per Gateway exists, but Agent Room does not use that mode.** OpenClaw supports distinct identities, isolated workspaces at `~/.openclaw/agents/<id>/workspace`, sessions, auth profiles, and per-agent `MEMORY.md` / `AGENTS.md` / `SOUL.md`. Agent Room still chooses one dedicated runtime per room and one room brain per room.
- **Cron.** `openclaw cron add|list|edit|run|runs|remove`. Persists to `~/.openclaw/cron/jobs.json`. Per-agent targeting. Retry config.
- **Gmail push trigger.** `openclaw webhooks gmail setup` — Gmail PubSub watch with auto-renewal.
- **Generic webhooks.** `POST /hooks/wake`, `POST /hooks/agent` with bearer auth.
- **Channels as triggers.** 20+ (WhatsApp, Telegram, Slack, Discord, iMessage, Signal, Matrix, Teams, Nostr...). Inbound trigger and outbound sink in one. Dedup and debounce built in.
- **HTTP + WebSocket API on :18789.** OpenAI-compatible `/v1/responses`, `/v1/chat/completions`, `/tools/invoke`, `/hooks/*`. WebSocket target is configurable — external UIs are a first-class client.
- **Skills.** 13,729 in ClawHub as of 2026-02-28. Skills are tools, not triggers (triggers are Gateway-level primitives).

## What we build

- TanStack Start + TypeScript + Tailwind + shadcn/ui. Bun for install and scripts.
- Control plane that supervises one isolated runtime endpoint per room over an internal execution-engine adapter boundary.
- Room directory across many room brains, with status and health visible before entering a room.
- Per-room view: one room brain summary plus live activity feed, session list, chat, cron and trigger config, memory/workspace visibility, and run history.
- Optional thin server additions, only when daily use demands them:
    - HMAC-verifying proxy in front of `/hooks/agent` for GitHub / Stripe / Slack-signed webhooks.
    - Non-Gmail email subscribers (IMAP, Outlook).

## What we do not build

- Agent loop, inference gateway, tool execution, skills, scheduler, channel adapters, Gmail push, webhook transport, per-agent memory, per-agent workspace — all OpenClaw.
- User-facing sandbox or engine choice.
- A broad plugin framework for many runtimes up front. We keep one strict room execution contract with one OpenClaw adapter first.
- Duplicate persistence. No schema mirroring OpenClaw state. Possibly a small SQLite for UI-only prefs (agent order, archived flag). May not be needed.

## Architecture

Pin OpenClaw as the only shipped execution-engine implementation; do not fork. Agent Room owns lifecycle, routing, locks, and reconciliation while OpenClaw runs one dedicated runtime per room behind the internal adapter boundary.

Ship Agent Room as a separate service that supervises room runtimes. Self-host with one command and include OpenClaw in the deploy path as the first engine implementation.

## Isolation Model

Isolation comes from one dedicated OpenClaw runtime per room, one room-local filesystem root per room, one bearer token per room, and one canonical Dockerized deployment path. Agent Room does not present sandbox profiles or alternate runtime modes in the product surface.

## Principles

- The agent is a colleague, not a session.
- The room execution engine owns runtime state. We own lifecycle, policy, UX, and reconciliation.
- Single source of truth: room runtime state plus room filesystem artifacts.
- One strict execution-engine contract now; no broad abstraction beyond what room isolation requires.
- Correctness beats surface area.

## Phase 0 conclusions

Historical note: this section captures desk-spike findings. Locked implementation direction after Phase 1 is per-room runtime isolation with an app-owned execution-engine contract, not a shared runtime endpoint model.

### Adjacent OSS

- **Mission Control** is useful as a lesson source, not a fork target. It is strong on deploy clarity, observability, and ops polish, but it centers tasks, governance, and framework adapters more than room-first OpenClaw truth.
- **Agent Zero** is a hierarchical framework where agents spawn subordinate agents. Good ideas: transparency, extensibility, and intervention. Wrong shape for N durable colleagues with separate rooms.
- **Hermes Agent** is the closest persistent-agent peer. Good ideas: persistent gateway, scheduled automations, session continuity, learning loop. Wrong default shape for this product because it is still one assistant you talk to across channels, not many room-first coworkers in one operator surface.
- **Anthropic Managed Agents** is useful as a conceptual north star for durable sessions, harness/session/sandbox separation, and many-brains-many-hands design, but it is hosted and Claude-specific, not an OSS OpenClaw room UI.

### OpenClaw gateway truth

- The Gateway and on-disk OpenClaw state are sufficient as the runtime source of truth for v0.
- Multi-agent isolation is explicit in docs and config semantics: distinct workspace, `agentDir`, auth profiles, and sessions per agent.
- Cron and `/hooks/agent` both support explicit per-agent targeting.
- OpenClaw transport is sufficient to back the first room runtime adapter.
- The bundled Control UI still does not solve the room-brain operator UX cleanly, which preserves the Agent Room wedge.

### Locked product decisions

1. **Default room view:** hybrid, biased toward recent unattended activity with chat always visible.
2. **Trigger UX:** typed per-trigger forms first. Add raw JSON only as a bounded advanced escape hatch later.
3. **UI-local persistence:** no SQLite for v0. Use browser-local state unless a clearly non-derivable UI concern proves itself in usage.
4. **Runtime isolation model:** exactly one dedicated OpenClaw runtime per room. No sandbox modes, no host OpenClaw path, and no multi-agent-inside-one-room model in the product surface.
5. **Deployment story:** one canonical `docker compose` self-hosting path with full functionality in the stack. The execution-engine boundary remains internal so OpenClaw can be replaced later, but there is no user-facing engine choice while OpenClaw is the only shipped engine.
