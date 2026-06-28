import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { SparklesIcon } from 'lucide-react'

import {
    AttentionBanner,
    CreateRoomButton,
    EmptyState,
    LoadingCards,
    Page,
    PageHeader,
    RoomGlyph,
    StateBadge,
} from '#/components/agent-room'
import { Button } from '#/components/ui/button'
import { CardButton } from '#/components/ui/card'
import { cn } from '#/lib/utils'
import { describeRoomState, toneStyles } from '#/domain/state'
import { sanitizeRuntimeError } from '#/domain/runtime-error'
import { ROOM_DESCRIPTION } from '#/components/agent-room/create-room-form'
import { formatRelativeTime } from '#/domain/format'
import { isHostedBalanceLow } from '@agent-room/billing'
import { roomQueryKey, roomQueryPolicy } from '#/lib/room-query-keys'
import type { RoomRuntimeOverview } from '#/domain/room-execution-types'
import { listRoomsServer } from './-room-runtime-server'
import { requireRouteUser } from './-route-auth'
import { getOperatorConfigServer } from './-operator-config-server'
import { hostedAvailableCents, useHostedBillingQuery } from './-billing/billing-data'

export const Route = createFileRoute('/')({
    beforeLoad: async () => {
        await requireRouteUser()
        const config = await getOperatorConfigServer()
        if (!config.onboarding.completed) {
            const rooms = await listRoomsServer()
            if (rooms.length === 0) {
                throw redirect({ to: '/onboarding' })
            }
        }
    },
    component: HomePage,
})

function HomePage() {
    const roomsQuery = useQuery({
        queryKey: roomQueryKey.roomsList,
        queryFn: () => listRoomsServer(),
        staleTime: roomQueryPolicy.warmStaleMs,
    })

    const rooms = roomsQuery.data ?? []

    return (
        <Page
            width="xl"
            header={
                <PageHeader
                    title="Rooms"
                    subtitle={ROOM_DESCRIPTION}
                    actions={<CreateRoomButton />}
                />
            }
        >
            <LowCreditBanner />
            {roomsQuery.isLoading ? (
                <LoadingCards count={6} />
            ) : roomsQuery.isError ? (
                <AttentionBanner
                    tone="danger"
                    title="Could not load your rooms"
                    description="Something went wrong while fetching this workspace."
                    action={
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => roomsQuery.refetch()}
                            disabled={roomsQuery.isFetching}
                        >
                            {roomsQuery.isFetching ? 'Retrying...' : 'Retry'}
                        </Button>
                    }
                />
            ) : rooms.length === 0 ? (
                <EmptyState
                    icon={SparklesIcon}
                    title="No rooms yet"
                    description="Create a room to start working with an AI coworker in its own isolated workspace."
                    action={<CreateRoomButton />}
                />
            ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {rooms.map((room) => (
                        <RoomCard key={room.roomId} room={room} />
                    ))}
                </div>
            )}
        </Page>
    )
}

function LowCreditBanner() {
    const billingQuery = useHostedBillingQuery()
    if (billingQuery.data?.status !== 'active') return null
    const summary = billingQuery.data.summary
    if (!isHostedBalanceLow(hostedAvailableCents(summary))) return null
    return (
        <AttentionBanner
            tone="attention"
            className="mb-4"
            title="You are running low on credits"
            description="Top up to keep your rooms working without interruption."
            action={
                <Button asChild size="sm">
                    <Link to="/billing" search={{ checkout: null }}>
                        Buy credits
                    </Link>
                </Button>
            }
        />
    )
}

function RoomCard({ room }: { room: RoomRuntimeOverview }) {
    const state = describeRoomState({
        status: room.status,
        desiredState: room.desiredState,
        healthStatus: room.healthStatus,
    })
    const needsSetup = room.status === 'setup_required'
    const attention = needsSetup
        ? 'Finish setup to start working.'
        : room.lastError
          ? sanitizeRuntimeError(room.lastError)
          : null

    return (
        <CardButton asChild className="flex-col gap-3 p-4">
            <Link to="/rooms/$roomId" params={{ roomId: room.roomId }}>
                <div className="flex items-start gap-3">
                    <RoomGlyph name={room.displayName} seed={room.roomId} />
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-foreground">
                            {room.displayName}
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                            <StateBadge tone={state.tone} label={state.label} />
                        </div>
                    </div>
                </div>
                {attention ? (
                    <p className={cn('line-clamp-2 text-xs', toneStyles[state.tone].text)}>
                        {attention}
                    </p>
                ) : null}
                <p className="mt-auto text-xs text-muted-foreground">
                    {room.lastHealthAt
                        ? `Active ${formatRelativeTime(room.lastHealthAt)}`
                        : 'No activity yet'}
                </p>
            </Link>
        </CardButton>
    )
}
