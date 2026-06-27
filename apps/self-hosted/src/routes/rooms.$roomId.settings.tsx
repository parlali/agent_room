import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AttentionBanner } from '#/components/agent-room'
import { TooltipProvider } from '#/components/ui/tooltip'
import { roomQueryKey, roomQueryPolicy } from '#/lib/room-query-keys'
import { getRoomConfigServer } from '#/routes/-operator-config-server'
import { listRoomsServer } from '#/routes/-room-runtime-server'
import { RoomSettingsBody } from './-room-settings/sections'

export const Route = createFileRoute('/rooms/$roomId/settings')({
    component: RoomSettingsPage,
})

function RoomSettingsPage() {
    const { roomId } = Route.useParams()
    const queryClient = useQueryClient()

    const roomConfigQuery = useQuery({
        queryKey: roomQueryKey.roomConfig(roomId),
        queryFn: () => getRoomConfigServer({ data: { roomId } }),
        staleTime: roomQueryPolicy.hotStaleMs,
    })

    const roomsQuery = useQuery({
        queryKey: roomQueryKey.roomsList,
        queryFn: () => listRoomsServer(),
        staleTime: roomQueryPolicy.warmStaleMs,
    })

    const room = roomsQuery.data?.find((r) => r.roomId === roomId) ?? null
    const snapshot = roomConfigQuery.data ?? null

    return (
        <TooltipProvider>
            <div className="mx-auto flex max-w-4xl flex-col gap-6">
                {roomConfigQuery.isError ? (
                    <AttentionBanner
                        tone="danger"
                        title="Could not load room settings"
                        description={
                            roomConfigQuery.error instanceof Error
                                ? roomConfigQuery.error.message
                                : 'Unexpected error'
                        }
                    />
                ) : null}

                {snapshot && !snapshot.effective.ready ? (
                    <AttentionBanner
                        tone="attention"
                        title="Room is not ready yet"
                        description={snapshot.effective.blockedReasons.join('; ')}
                    />
                ) : null}

                <RoomSettingsBody
                    roomId={roomId}
                    snapshot={snapshot}
                    paused={room?.desiredState === 'stopped'}
                    roomSlug={room?.slug ?? ''}
                    roomDisplayName={room?.displayName ?? ''}
                    loading={roomConfigQuery.isLoading}
                    roomsLoading={roomsQuery.isLoading}
                    onSaved={async () => {
                        await queryClient.invalidateQueries({
                            queryKey: roomQueryKey.roomConfig(roomId),
                        })
                    }}
                />
            </div>
        </TooltipProvider>
    )
}
