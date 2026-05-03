import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { BarChart3Icon } from 'lucide-react'

import { AppShell } from '#/components/app-shell'
import { EmptyState, LoadingRows, PageHeader, RoomGlyph, Section } from '#/components/agent-room'
import { Badge } from '#/components/ui/badge'
import { formatCostUsd, formatDurationMs, formatRelativeTime, formatTokens } from '#/lib/format'
import { listRoomsServer, listUsageServer } from './-room-runtime-server'
import { requireRouteUser } from './-route-auth'

export const Route = createFileRoute('/usage')({
    beforeLoad: requireRouteUser,
    component: UsagePage,
})

type UsageEvent = Awaited<ReturnType<typeof listUsageServer>>['events'][number]

function UsagePage() {
    const usageQuery = useQuery({
        queryKey: ['usage-global'],
        queryFn: () => listUsageServer({ data: { limit: 300 } }),
        staleTime: 10_000,
    })
    const roomsQuery = useQuery({
        queryKey: ['rooms-list'],
        queryFn: () => listRoomsServer(),
        staleTime: 30_000,
    })

    const roomsById = new Map((roomsQuery.data ?? []).map((room) => [room.roomId, room]))
    const events = usageQuery.data?.events ?? []
    const totals = usageQuery.data?.totals

    return (
        <AppShell>
            <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
                <PageHeader
                    title="Usage"
                    subtitle="Runtime, token, tool, document, image, and job usage across rooms."
                />

                <div className="mt-6 space-y-4">
                    <Section title="Totals" description="Unknown provider fields remain explicit.">
                        {usageQuery.isLoading ? (
                            <LoadingRows count={2} />
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

                    <Section title="Recent Events" description="Most recent usage records first.">
                        {usageQuery.isLoading ? (
                            <LoadingRows count={6} />
                        ) : events.length === 0 ? (
                            <EmptyState
                                icon={BarChart3Icon}
                                title="No usage recorded"
                                description="Room work, tools, jobs, documents, and image requests will appear here."
                            />
                        ) : (
                            <ul className="divide-y divide-border/60">
                                {events.map((event) => (
                                    <UsageRow
                                        key={event.id}
                                        event={event}
                                        room={event.roomId ? roomsById.get(event.roomId) : null}
                                    />
                                ))}
                            </ul>
                        )}
                    </Section>
                </div>
            </div>
        </AppShell>
    )
}

function UsageRow({
    event,
    room,
}: {
    event: UsageEvent
    room: Awaited<ReturnType<typeof listRoomsServer>>[number] | null | undefined
}) {
    const title = event.toolName ?? event.model ?? event.provider ?? 'Runtime'
    const inner = (
        <>
            <Badge variant="outline">{event.kind}</Badge>
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                    {room ? (
                        <RoomGlyph name={room.displayName} seed={room.roomId} size="xs" />
                    ) : null}
                    <span className="font-medium text-foreground">{title}</span>
                    <span className="text-muted-foreground">
                        {formatDurationMs(event.durationMs)}
                    </span>
                    <span className="text-muted-foreground">
                        {formatRelativeTime(event.createdAt)}
                    </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{room?.displayName ?? 'No room'}</span>
                    <span>Tokens {formatTokens(event.totalTokens)}</span>
                    <span>
                        Cost{' '}
                        {event.estimatedCostUsd === null
                            ? 'Unknown'
                            : formatCostUsd(Number(event.estimatedCostUsd))}
                    </span>
                </div>
            </div>
        </>
    )

    return (
        <li>
            {room ? (
                <Link
                    to="/rooms/$roomId/usage"
                    params={{ roomId: room.roomId }}
                    className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-accent/40"
                >
                    {inner}
                </Link>
            ) : (
                <div className="flex items-start gap-3 px-4 py-3">{inner}</div>
            )}
        </li>
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
