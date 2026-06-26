import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RoomDashboardLayout } from '#/components/room-dashboard'
import { AttentionBanner } from '#/components/agent-room'
import { TooltipProvider } from '#/components/ui/tooltip'
import { roomQueryKey, roomQueryPolicy } from '#/lib/room-query-keys'
import { getRoomConfigServer } from '#/routes/-operator-config-server'
import { listRoomsServer } from '#/routes/-room-runtime-server'
import {
    ConfigSections,
    DangerZoneSection,
    PauseAndArchiveSection,
    SecretsSection,
} from './-room-settings/sections'

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
        <RoomDashboardLayout roomId={roomId} activeTab="settings">
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

                    <ConfigSections
                        roomId={roomId}
                        snapshot={snapshot}
                        loading={roomConfigQuery.isLoading}
                        onSaved={async () => {
                            await queryClient.invalidateQueries({
                                queryKey: roomQueryKey.roomConfig(roomId),
                            })
                        }}
                    />

                    <SecretsSection
                        roomId={roomId}
                        loading={roomConfigQuery.isLoading}
                        secrets={snapshot?.roomSecrets ?? []}
                        onSaved={async () => {
                            await queryClient.invalidateQueries({
                                queryKey: roomQueryKey.roomConfig(roomId),
                            })
                        }}
                    />

                    <PauseAndArchiveSection
                        roomId={roomId}
                        paused={room?.desiredState === 'stopped'}
                        loading={roomsQuery.isLoading}
                    />

                    <DangerZoneSection
                        roomId={roomId}
                        roomSlug={room?.slug ?? ''}
                        roomDisplayName={room?.displayName ?? ''}
                        loading={roomsQuery.isLoading}
                    />
                </div>
            </TooltipProvider>
        </RoomDashboardLayout>
    )
}
