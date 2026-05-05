import { Link } from '@tanstack/react-router'
import { Badge } from '#/components/ui/badge'
import { RoomGlyph } from '#/components/agent-room'
import { formatCostUsd, formatDurationMs, formatRelativeTime, formatTokens } from '#/lib/format'

interface UsageEventLike {
    kind: string
    provider: string | null
    model: string | null
    toolName: string | null
    totalTokens: number | null
    durationMs: number | null
    estimatedCostUsd: string | null
    createdAt: Date
}

interface UsageRoomContext {
    roomId: string
    displayName: string
}

function usageTitle(event: UsageEventLike): string {
    return event.toolName ?? event.model ?? event.provider ?? 'Runtime'
}

function usageEventBody({
    event,
    room,
    showRoom,
    tokenUnknownLabel,
    costUnknownLabel,
}: {
    event: UsageEventLike
    room?: UsageRoomContext | null
    showRoom: boolean
    tokenUnknownLabel: string
    costUnknownLabel: string
}) {
    return (
        <>
            <Badge variant="outline">{event.kind}</Badge>
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                    {showRoom && room ? (
                        <RoomGlyph name={room.displayName} seed={room.roomId} size="xs" />
                    ) : null}
                    <span className="font-medium text-foreground">{usageTitle(event)}</span>
                    <span className="text-muted-foreground">
                        {formatDurationMs(event.durationMs)}
                    </span>
                    <span className="text-muted-foreground">
                        {formatRelativeTime(event.createdAt)}
                    </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {showRoom ? <span>{room?.displayName ?? 'No room'}</span> : null}
                    <span>
                        Tokens{' '}
                        {event.totalTokens === null
                            ? tokenUnknownLabel
                            : formatTokens(event.totalTokens)}
                    </span>
                    <span>
                        Cost{' '}
                        {event.estimatedCostUsd === null
                            ? costUnknownLabel
                            : formatCostUsd(Number(event.estimatedCostUsd))}
                    </span>
                </div>
            </div>
        </>
    )
}

export function UsageEventRow({
    event,
    room,
    linkToRoom = false,
    padded = false,
    showRoom = false,
    tokenUnknownLabel = 'unknown',
    costUnknownLabel = 'unknown',
}: {
    event: UsageEventLike
    room?: UsageRoomContext | null
    linkToRoom?: boolean
    padded?: boolean
    showRoom?: boolean
    tokenUnknownLabel?: string
    costUnknownLabel?: string
}) {
    const className = `flex items-start gap-3 ${padded ? 'px-4 py-3' : 'py-3'}`
    const body = usageEventBody({
        event,
        room,
        showRoom,
        tokenUnknownLabel,
        costUnknownLabel,
    })

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
    eventCount,
    totals,
}: {
    eventCount: number
    totals?: {
        durationMs?: number | null
        totalTokens?: number | null
        estimatedCostUsd?: number | null
    } | null
}) {
    return (
        <div className="grid gap-3 sm:grid-cols-4">
            <UsageMetric label="Events" value={String(eventCount)} />
            <UsageMetric label="Runtime" value={formatDurationMs(totals?.durationMs ?? null)} />
            <UsageMetric label="Tokens" value={formatTokens(totals?.totalTokens ?? null)} />
            <UsageMetric label="Cost" value={formatCostUsd(totals?.estimatedCostUsd ?? null)} />
        </div>
    )
}
