import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Loader2Icon, MessagesSquareIcon, RotateCwIcon, TriangleAlertIcon } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { RoomSetupRequiredState, roomNeedsSetup } from '#/components/room-dashboard'
import { EmptyState, LoadingPage, useStartRoomSession } from '#/components/agent-room'
import { markChatSelection } from '#/lib/browser-performance'
import { roomQueryKey, roomQueryPolicy } from '#/lib/room-query-keys'
import { getRoomSidebarServer } from './-room-runtime-server'

export const Route = createFileRoute('/rooms/$roomId/')({
    component: RoomChatLandingRoute,
})

function RoomChatLandingRoute() {
    const { roomId } = Route.useParams()
    return <RoomChatLanding roomId={roomId} />
}

function RoomChatLanding({ roomId }: { roomId: string }) {
    const navigate = useNavigate()
    const sidebarQuery = useQuery({
        queryKey: roomQueryKey.roomSidebar(roomId),
        queryFn: () => getRoomSidebarServer({ data: { roomId } }),
        staleTime: roomQueryPolicy.hotStaleMs,
    })

    const snapshot = sidebarQuery.data
    const setup = snapshot?.setup ?? null
    const room = snapshot?.room ?? null
    const threads = snapshot?.threads ?? []
    const latestThread = threads[0] ?? null
    const onboarding = setup?.phase === 'onboarding'
    const starting = setup?.phase === 'starting'
    const shouldOpenLatest = Boolean(latestThread) && !onboarding
    const needsSetup = Boolean(setup && room && roomNeedsSetup({ setup, room }))

    useEffect(() => {
        if (!shouldOpenLatest || !latestThread) return
        markChatSelection(roomId, latestThread.key)
        void navigate({
            to: '/rooms/$roomId/sessions/$sessionKey',
            params: { roomId, sessionKey: latestThread.key },
            replace: true,
        })
    }, [navigate, roomId, shouldOpenLatest, latestThread])

    const content =
        sidebarQuery.isLoading || shouldOpenLatest ? (
            <LoadingPage />
        ) : sidebarQuery.isError ? (
            <EmptyState
                icon={TriangleAlertIcon}
                title="Could not load this room"
                description="We hit a problem loading this room. Check your connection and try again."
                action={
                    <Button
                        variant="outline"
                        onClick={() => void sidebarQuery.refetch()}
                        disabled={sidebarQuery.isFetching}
                    >
                        <RotateCwIcon /> Try again
                    </Button>
                }
            />
        ) : onboarding ? (
            <EmptyState
                icon={RotateCwIcon}
                title="This room is still starting"
                description="The setup session is being prepared. This page will update when it is ready."
                action={
                    <Button
                        variant="outline"
                        onClick={() => void sidebarQuery.refetch()}
                        disabled={sidebarQuery.isFetching}
                    >
                        <RotateCwIcon /> Check again
                    </Button>
                }
            />
        ) : starting ? (
            <EmptyState
                icon={RotateCwIcon}
                title="This room is starting"
                description={
                    setup?.message ??
                    'The room is waking up. This page will update when it is ready to start a conversation.'
                }
                action={
                    <Button
                        variant="outline"
                        onClick={() => void sidebarQuery.refetch()}
                        disabled={sidebarQuery.isFetching}
                    >
                        {sidebarQuery.isFetching ? (
                            <Loader2Icon className="animate-spin" />
                        ) : (
                            <RotateCwIcon />
                        )}
                        Check again
                    </Button>
                }
            />
        ) : needsSetup ? (
            <RoomSetupRequiredState
                action={
                    <Button asChild>
                        <Link to="/settings" hash="advanced">
                            Finish setup
                        </Link>
                    </Button>
                }
            />
        ) : (
            <StartConversationEmptyState
                roomId={roomId}
                canStart={setup?.canStartSessions ?? true}
                disabledReason={setup?.message ?? null}
            />
        )

    return <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">{content}</div>
}

function StartConversationEmptyState({
    roomId,
    canStart,
    disabledReason,
}: {
    roomId: string
    canStart: boolean
    disabledReason: string | null
}) {
    const startSession = useStartRoomSession({ roomId })
    const pending = startSession.isPending
    return (
        <EmptyState
            icon={MessagesSquareIcon}
            title="Start your first conversation"
            description="Ask this room to research a topic, read a link, draft a document, or work with your files."
            action={
                <div className="flex flex-col items-center gap-2">
                    <Button onClick={() => startSession.mutate()} disabled={pending || !canStart}>
                        {pending ? (
                            <>
                                <Loader2Icon className="animate-spin" /> Starting...
                            </>
                        ) : (
                            <>
                                <MessagesSquareIcon /> Start a conversation
                            </>
                        )}
                    </Button>
                    {!canStart && disabledReason ? (
                        <p className="text-xs text-muted-foreground">{disabledReason}</p>
                    ) : null}
                </div>
            }
        />
    )
}
