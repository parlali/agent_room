import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { BarChart3Icon } from 'lucide-react'

import { AppShell } from '#/components/app-shell'
import { EmptyState, LoadingRows, PageHeader, Section } from '#/components/agent-room'
import { listRoomsServer, listUsageServer } from './-room-runtime-server'
import { requireRouteUser } from './-route-auth'
import { UsageEventRow, UsageTotalsGrid } from './-usage/usage-components'

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
                            <UsageTotalsGrid eventCount={events.length} totals={totals} />
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
    return (
        <UsageEventRow
            event={event}
            room={room}
            showRoom
            padded
            linkToRoom
            tokenUnknownLabel="Unknown"
            costUnknownLabel="Unknown"
        />
    )
}
