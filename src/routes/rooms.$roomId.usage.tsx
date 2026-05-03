import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { BarChart3Icon } from 'lucide-react'

import { Badge } from '#/components/ui/badge'
import { RoomDashboardLayout } from '#/components/room-dashboard'
import { EmptyState, LoadingRows, Section } from '#/components/agent-room'
import { formatCostUsd, formatDurationMs, formatRelativeTime, formatTokens } from '#/lib/format'
import { listRoomUsageServer } from '#/routes/-room-runtime-server'
import { requireRouteUser } from '#/routes/-route-auth'

type UsageEvent = {
    id: string
    kind: string
    provider: string | null
    model: string | null
    toolName: string | null
    totalTokens: number | null
    durationMs: number | null
    estimatedCostUsd: string | null
    metadata: unknown
    createdAt: Date
}

export const Route = createFileRoute('/rooms/$roomId/usage')({
    beforeLoad: requireRouteUser,
    component: RoomUsagePage,
})

function RoomUsagePage() {
    const { roomId } = Route.useParams()
    return (
        <RoomDashboardLayout roomId={roomId} activeTab="usage">
            <UsageContent roomId={roomId} />
        </RoomDashboardLayout>
    )
}

function UsageContent({ roomId }: { roomId: string }) {
    const usageQuery = useQuery({
        queryKey: ['room-usage', roomId],
        queryFn: () => listRoomUsageServer({ data: { roomId, limit: 100 } }),
        staleTime: 5_000,
    })
    const events = (usageQuery.data?.events ?? []) as UsageEvent[]
    const totals = usageQuery.data?.totals

    return (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
            <Section title="Usage" description="Room runs, tools, jobs, tokens, and cost tracking.">
                {usageQuery.isLoading ? (
                    <LoadingRows count={4} />
                ) : usageQuery.isError ? (
                    <EmptyState
                        icon={BarChart3Icon}
                        title="Could not load usage"
                        description={
                            usageQuery.error instanceof Error
                                ? usageQuery.error.message
                                : 'Unexpected usage error.'
                        }
                    />
                ) : (
                    <div className="grid gap-3 sm:grid-cols-4">
                        <Metric label="Events" value={String(events.length)} />
                        <Metric
                            label="Runtime"
                            value={formatDurationMs(totals?.durationMs ?? null)}
                        />
                        <Metric
                            label="Tokens"
                            value={formatTokens(totals?.totalTokens ?? null)}
                        />
                        <Metric
                            label="Cost"
                            value={formatCostUsd(totals?.estimatedCostUsd ?? null)}
                        />
                    </div>
                )}
            </Section>
            <Section title="Events" description="Unknown usage remains explicit until the provider exposes it.">
                {events.length === 0 ? (
                    <EmptyState
                        icon={BarChart3Icon}
                        title="No usage yet"
                        description="Run a message, job, tool, document worker, or image request to populate usage."
                    />
                ) : (
                    <ul className="divide-y divide-border/60">
                        {events.map((event) => (
                            <li key={event.id} className="flex items-start gap-3 py-3">
                                <Badge variant="outline">{event.kind}</Badge>
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2 text-sm">
                                        <span className="font-medium text-foreground">
                                            {event.toolName ?? event.model ?? event.provider ?? 'Runtime'}
                                        </span>
                                        <span className="text-muted-foreground">
                                            {formatDurationMs(event.durationMs)}
                                        </span>
                                        <span className="text-muted-foreground">
                                            {formatRelativeTime(event.createdAt)}
                                        </span>
                                    </div>
                                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                                        <span>
                                            Tokens{' '}
                                            {event.totalTokens === null
                                                ? 'unknown'
                                                : formatTokens(event.totalTokens)}
                                        </span>
                                        <span>
                                            Cost{' '}
                                            {event.estimatedCostUsd === null
                                                ? 'unknown'
                                                : formatCostUsd(Number(event.estimatedCostUsd))}
                                        </span>
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </Section>
        </div>
    )
}

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-md border border-border/60 bg-card p-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="mt-1 text-lg font-semibold text-foreground">{value}</div>
        </div>
    )
}
