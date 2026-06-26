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
import { describeRoomState } from '#/domain/state'
import { formatRelativeTime } from '#/domain/format'
import { roomQueryKey, roomQueryPolicy } from '#/lib/room-query-keys'
import type { RoomRuntimeOverview } from '#/domain/room-execution-types'
import { listRoomsServer } from './-room-runtime-server'
import { requireRouteUser } from './-route-auth'
import { getOperatorConfigServer } from './-operator-config-server'

export const Route = createFileRoute('/')({
    beforeLoad: async () => {
        await requireRouteUser()
        const config = await getOperatorConfigServer()
        if (!config.onboarding.completed) {
            throw redirect({ to: '/onboarding' })
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
                    subtitle="Each room is an isolated workspace for an AI coworker."
                    actions={<CreateRoomButton />}
                />
            }
        >
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

function RoomCard({ room }: { room: RoomRuntimeOverview }) {
    const state = describeRoomState({
        status: room.status,
        desiredState: room.desiredState,
        healthStatus: room.healthStatus,
    })
    const needsSetup = room.status === 'setup_required'
    const attention = needsSetup ? 'Needs setup before it can run.' : room.lastError

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
                    <p
                        className={cn(
                            'line-clamp-2 text-xs',
                            needsSetup ? 'text-attention-fg' : 'text-danger-fg',
                        )}
                    >
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
