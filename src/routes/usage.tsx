import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { BarChart3Icon } from 'lucide-react'

import { EmptyState, LoadingRows, PageHeader, Section } from '#/components/agent-room'
import { roomQueryKey, roomQueryPolicy } from '#/lib/room-query-keys'
import { listRoomsServer, listUsageServer } from './-room-runtime-server'
import { requireRouteUser } from './-route-auth'
import { UsageTimeline, UsageTotalsGrid, usageTimelineCount } from './-usage/usage-components'

export const Route = createFileRoute('/usage')({
    beforeLoad: requireRouteUser,
    component: UsagePage,
})

function UsagePage() {
    const usageQuery = useQuery({
        queryKey: roomQueryKey.globalUsage(300),
        queryFn: () => listUsageServer({ data: { limit: 300 } }),
        staleTime: roomQueryPolicy.warmStaleMs,
    })
    const roomsQuery = useQuery({
        queryKey: roomQueryKey.roomsList,
        queryFn: () => listRoomsServer(),
        staleTime: roomQueryPolicy.coldStaleMs,
    })

    const roomsById = new Map((roomsQuery.data ?? []).map((room) => [room.roomId, room]))
    const events = usageQuery.data?.events ?? []
    const totals = usageQuery.data?.totals

    return (
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
                        <UsageTotalsGrid
                            activityCount={usageTimelineCount(events)}
                            totals={totals}
                        />
                    )}
                </Section>

                <Section title="Recent Activity" description="Most recent room work first.">
                    {usageQuery.isLoading ? (
                        <LoadingRows count={6} />
                    ) : events.length === 0 ? (
                        <EmptyState
                            icon={BarChart3Icon}
                            title="No activity recorded"
                            description="Room work, tools, jobs, documents, and image requests will appear here."
                        />
                    ) : (
                        <UsageTimeline
                            events={events}
                            roomsById={roomsById}
                            showRoom
                            padded
                            linkToRoom
                        />
                    )}
                </Section>
            </div>
        </div>
    )
}
