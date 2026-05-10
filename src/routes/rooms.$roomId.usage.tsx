import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { BarChart3Icon } from 'lucide-react'

import { RoomDashboardLayout } from '#/components/room-dashboard'
import { EmptyState, LoadingRows, Section } from '#/components/agent-room'
import { listRoomUsageServer } from '#/routes/-room-runtime-server'
import { requireRouteUser } from '#/routes/-route-auth'
import { UsageTimeline, UsageTotalsGrid, usageTimelineCount } from './-usage/usage-components'

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
                    <UsageTotalsGrid activityCount={usageTimelineCount(events)} totals={totals} />
                )}
            </Section>
            <Section title="Activity" description="Recent room work, summarized for operators.">
                {events.length === 0 ? (
                    <EmptyState
                        icon={BarChart3Icon}
                        title="No activity yet"
                        description="Run a message, job, tool, document worker, or image request to populate usage."
                    />
                ) : (
                    <UsageTimeline events={events} />
                )}
            </Section>
        </div>
    )
}
