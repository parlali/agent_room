import { Link, Outlet, createFileRoute, useNavigate, useRouterState } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { MessagesSquareIcon, RotateCwIcon, TriangleAlertIcon } from 'lucide-react'

import { Button } from '#/components/ui/button'
import {
    RoomDashboardLayout,
    RoomSetupRequiredState,
    roomNeedsSetup,
} from '#/components/room-dashboard'
import { EmptyState, LoadingPage, useStartRoomSession } from '#/components/agent-room'
import { markChatSelection } from '#/lib/browser-performance'
import { roomQueryKey, roomQueryPolicy } from '#/lib/room-query-keys'
import { requireRouteUser } from './-route-auth'
import { getRoomSidebarServer } from './-room-runtime-server'
import { useRoomEventCacheSync } from './-session-chat/room-event-cache'

export const Route = createFileRoute('/rooms/$roomId')({
    beforeLoad: requireRouteUser,
    component: RoomRoute,
})

function RoomRoute() {
    const { roomId } = Route.useParams()
    const queryClient = useQueryClient()
    const pathname = useRouterState({
        select: (state) => state.location.pathname,
    })
    useRoomEventCacheSync({ roomId, queryClient })

    if (pathname !== `/rooms/${roomId}`) {
        return <Outlet />
    }

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

    if (sidebarQuery.isLoading || shouldOpenLatest || onboarding) {
        return (
            <RoomDashboardLayout roomId={roomId} activeTab="chat">
                <LoadingPage />
            </RoomDashboardLayout>
        )
    }

    if (sidebarQuery.isError) {
        return (
            <RoomDashboardLayout roomId={roomId} activeTab="chat">
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
            </RoomDashboardLayout>
        )
    }

    if (needsSetup) {
        return (
            <RoomDashboardLayout roomId={roomId} activeTab="chat">
                <RoomSetupRequiredState
                    action={
                        <Button asChild>
                            <Link to="/settings" hash="advanced">
                                Finish setup
                            </Link>
                        </Button>
                    }
                />
            </RoomDashboardLayout>
        )
    }

    return (
        <RoomDashboardLayout roomId={roomId} activeTab="chat">
            <StartConversationEmptyState
                roomId={roomId}
                canStart={setup?.canStartSessions ?? true}
            />
        </RoomDashboardLayout>
    )
}

function StartConversationEmptyState({ roomId, canStart }: { roomId: string; canStart: boolean }) {
    const startSession = useStartRoomSession({ roomId })
    return (
        <EmptyState
            icon={MessagesSquareIcon}
            title="Start your first conversation"
            description="Ask this room to research a topic, read a link, draft a document, or work with your files."
            action={
                <Button
                    onClick={() => startSession.mutate()}
                    disabled={startSession.isPending || !canStart}
                >
                    <MessagesSquareIcon /> Start a conversation
                </Button>
            }
        />
    )
}
