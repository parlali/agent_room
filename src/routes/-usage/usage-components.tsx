import { Link } from '@tanstack/react-router'
import { Badge } from '#/components/ui/badge'
import { RoomGlyph } from '#/components/agent-room'
import { formatCostUsd, formatDurationMs, formatRelativeTime, formatTokens } from '#/lib/format'

interface UsageEventLike {
    id: string
    roomId?: string | null
    sessionKey?: string | null
    runId?: string | null
    jobId?: string | null
    kind: string
    provider: string | null
    model: string | null
    toolName: string | null
    totalTokens: number | null
    durationMs: number | null
    estimatedCostUsd: string | null
    metadata?: unknown
    createdAt: Date
}

interface UsageRoomContext {
    roomId: string
    displayName: string
}

interface UsageTimelineItem {
    id: string
    event: UsageEventLike
    title: string
    detail: string
    kindLabel: string
}

function metadataRecord(event: UsageEventLike): Record<string, unknown> {
    return event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
        ? (event.metadata as Record<string, unknown>)
        : {}
}

function toolLabel(toolName: string | null): string {
    if (!toolName) return 'room tool'
    const cleaned = toolName
        .replace(/^agent_room_/, '')
        .replaceAll('_', ' ')
        .trim()
    if (!cleaned) return 'room tool'
    if (cleaned === 'shell') return 'workspace command'
    if (cleaned === 'workspace tree') return 'workspace files'
    if (cleaned === 'list') return 'listed room information'
    if (cleaned === 'read') return 'read files'
    return cleaned
}

function providerModel(event: UsageEventLike): string | null {
    if (event.provider && event.model) return `${event.provider}/${event.model}`
    return event.model ?? event.provider
}

function runTitle(event: UsageEventLike): string {
    const metadata = metadataRecord(event)
    const runKind = typeof metadata.runKind === 'string' ? metadata.runKind : null
    if (event.kind === 'job' || runKind === 'scheduled') return 'Scheduled job ran'
    if (runKind === 'subagent') return 'Subagent worked'
    if (runKind === 'maintenance') return 'Maintenance ran'
    return 'Room answered a message'
}

function standaloneTitle(event: UsageEventLike): string {
    if (event.kind === 'image') return 'Generated an image'
    if (event.kind === 'document_worker') return 'Worked on a document'
    if (event.kind === 'tool') return `Used ${toolLabel(event.toolName)}`
    if (event.kind === 'provider') return 'Called a model provider'
    return runTitle(event)
}

function usageSummary(event: UsageEventLike): string | null {
    const tokens = event.totalTokens === null ? null : formatTokens(event.totalTokens)
    const cost =
        event.estimatedCostUsd === null ? null : formatCostUsd(Number(event.estimatedCostUsd))
    if (tokens && cost) return `${tokens} tokens · ${cost}`
    if (tokens) return `${tokens} tokens`
    if (cost) return cost
    return null
}

function buildTimelineItems(events: UsageEventLike[]): UsageTimelineItem[] {
    const eventsByRunId = new Map<string, UsageEventLike[]>()
    for (const event of events) {
        if (!event.runId) continue
        const existing = eventsByRunId.get(event.runId) ?? []
        existing.push(event)
        eventsByRunId.set(event.runId, existing)
    }

    return events
        .filter((event) => {
            if (event.kind === 'run' || event.kind === 'job') return true
            return !event.runId || !eventsByRunId.get(event.runId)?.some((entry) => entry.kind === 'run' || entry.kind === 'job')
        })
        .map((event) => {
            const related = event.runId ? (eventsByRunId.get(event.runId) ?? []) : []
            const relatedTools = related.filter(
                (entry) =>
                    entry.id !== event.id &&
                    (entry.kind === 'tool' ||
                        entry.kind === 'document_worker' ||
                        entry.kind === 'image'),
            )
            const toolNames = [...new Set(relatedTools.map((entry) => toolLabel(entry.toolName)))]
            const model = providerModel(event)
            const usage = usageSummary(event)
            const details = [
                model,
                formatDurationMs(event.durationMs),
                usage,
                relatedTools.length > 0
                    ? `Used ${relatedTools.length} ${relatedTools.length === 1 ? 'tool' : 'tools'}${toolNames.length > 0 ? `: ${toolNames.slice(0, 3).join(', ')}${toolNames.length > 3 ? ', and more' : ''}` : ''}`
                    : null,
            ].filter((value): value is string => Boolean(value && value !== '-'))
            return {
                id: event.id,
                event,
                title: event.kind === 'run' || event.kind === 'job' ? runTitle(event) : standaloneTitle(event),
                detail:
                    details.length > 0
                        ? details.join(' · ')
                        : event.totalTokens === null
                          ? 'Provider did not report token usage'
                          : 'Usage recorded',
                kindLabel:
                    event.kind === 'run'
                        ? 'message'
                        : event.kind === 'job'
                          ? 'job'
                          : event.kind === 'document_worker'
                            ? 'document'
                            : event.kind,
            }
        })
}

export function usageTimelineCount(events: UsageEventLike[]): number {
    return buildTimelineItems(events).length
}

export function UsageTimeline({
    events,
    roomsById,
    showRoom = false,
    linkToRoom = false,
    padded = false,
}: {
    events: UsageEventLike[]
    roomsById?: Map<string, UsageRoomContext>
    showRoom?: boolean
    linkToRoom?: boolean
    padded?: boolean
}) {
    const items = buildTimelineItems(events)
    return (
        <ul className="divide-y divide-border/60">
            {items.map((item) => {
                const room = item.event.roomId ? roomsById?.get(item.event.roomId) : null
                return (
                    <UsageTimelineRow
                        key={item.id}
                        item={item}
                        room={room}
                        showRoom={showRoom}
                        linkToRoom={linkToRoom}
                        padded={padded}
                    />
                )
            })}
        </ul>
    )
}

function UsageTimelineRow({
    item,
    room,
    showRoom,
    linkToRoom,
    padded,
}: {
    item: UsageTimelineItem
    room?: UsageRoomContext | null
    showRoom: boolean
    linkToRoom: boolean
    padded: boolean
}) {
    const className = `flex items-start gap-3 ${padded ? 'px-4 py-3' : 'py-3'}`
    const body = (
        <>
            <Badge variant="outline" className="mt-0.5 shrink-0">
                {item.kindLabel}
            </Badge>
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                    {showRoom && room ? (
                        <RoomGlyph name={room.displayName} seed={room.roomId} size="xs" />
                    ) : null}
                    <span className="font-medium text-foreground">{item.title}</span>
                    <span className="text-muted-foreground">
                        {formatRelativeTime(item.event.createdAt)}
                    </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {showRoom ? <span>{room?.displayName ?? 'No room'}</span> : null}
                    <span>{item.detail}</span>
                </div>
            </div>
        </>
    )

    return (
        <li>
            {linkToRoom && room ? (
                <Link
                    to="/rooms/$roomId/usage"
                    params={{ roomId: room.roomId }}
                    className={`${className} transition-colors hover:bg-accent/40`}
                >
                    {body}
                </Link>
            ) : (
                <div className={className}>{body}</div>
            )}
        </li>
    )
}

export function UsageMetric({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-md border border-border/60 bg-card p-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="mt-1 text-lg font-semibold text-foreground">{value}</div>
        </div>
    )
}

export function UsageTotalsGrid({
    activityCount,
    totals,
}: {
    activityCount: number
    totals?: {
        eventCount?: number | null
        durationMs?: number | null
        totalTokens?: number | null
        estimatedCostUsd?: number | null
    } | null
}) {
    return (
        <div className="grid gap-3 sm:grid-cols-4">
            <UsageMetric label="Activities" value={String(activityCount)} />
            <UsageMetric label="Runtime" value={formatDurationMs(totals?.durationMs ?? null)} />
            <UsageMetric
                label="Tokens"
                value={
                    totals?.totalTokens === null || totals?.totalTokens === undefined
                        ? 'Not reported'
                        : formatTokens(totals.totalTokens)
                }
            />
            <UsageMetric
                label="Estimated cost"
                value={
                    totals?.estimatedCostUsd === null || totals?.estimatedCostUsd === undefined
                        ? 'Not reported'
                        : formatCostUsd(totals.estimatedCostUsd)
                }
            />
        </div>
    )
}
