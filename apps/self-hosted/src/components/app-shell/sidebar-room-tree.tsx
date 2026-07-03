import { useEffect, useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'

import { cn } from '#/lib/utils'
import { describeRoomState } from '#/domain/state'
import { StatusDot } from '#/components/agent-room'
import { markChatSelection } from '#/lib/browser-performance'
import { getRoomSidebarServer } from '#/routes/-room-runtime-server'
import { roomQueryKey, roomQueryPolicy } from '#/lib/room-query-keys'
import {
    resolveActiveRoomId,
    roomIdFromPathname,
    shouldClearOptimisticRoomId,
} from '#/lib/room-pathname'
import type { RoomRuntimeOverview } from '#/domain/room-execution-types'

export function SidebarRoomTree({ rooms }: { rooms: RoomRuntimeOverview[] }) {
    const queryClient = useQueryClient()
    const pathname = useRouterState({ select: (s) => s.location.pathname })
    const routeRoomId = roomIdFromPathname(pathname)
    const [optimisticRoomId, setOptimisticRoomId] = useState<string | null>(null)
    const activeRoomId = resolveActiveRoomId({ routeRoomId, optimisticRoomId })

    useEffect(() => {
        if (shouldClearOptimisticRoomId({ routeRoomId, optimisticRoomId })) {
            setOptimisticRoomId(null)
        }
    }, [routeRoomId, optimisticRoomId])

    const prefetchRoomSidebar = (roomId: string) => {
        void queryClient.prefetchQuery({
            queryKey: roomQueryKey.roomSidebar(roomId),
            queryFn: () => getRoomSidebarServer({ data: { roomId } }),
            staleTime: roomQueryPolicy.hotStaleMs,
        })
    }

    if (rooms.length === 0) {
        return (
            <div className="px-2 py-4 text-xs text-muted-foreground">
                No rooms yet. Use the + above to add one.
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-0.5 px-1">
            {rooms.map((room) => {
                const state = describeRoomState({
                    status: room.status,
                    desiredState: room.desiredState,
                    healthStatus: room.healthStatus,
                })
                const latestThreadKey = room.latestThreadKey ?? null
                const linkClassName = cn(
                    'flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-sidebar-accent',
                    activeRoomId === room.roomId
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                        : 'text-muted-foreground hover:text-sidebar-accent-foreground',
                )
                const content = (
                    <>
                        <span className="min-w-0 flex-1 truncate font-medium">
                            {room.displayName}
                        </span>
                        <StatusDot
                            tone={state.tone}
                            pulse={state.tone === 'working'}
                            label={state.label}
                            className="shrink-0"
                        />
                    </>
                )
                if (latestThreadKey) {
                    return (
                        <Link
                            key={room.roomId}
                            to="/rooms/$roomId/sessions/$sessionKey"
                            params={{ roomId: room.roomId, sessionKey: latestThreadKey }}
                            onMouseEnter={() => prefetchRoomSidebar(room.roomId)}
                            onFocus={() => prefetchRoomSidebar(room.roomId)}
                            onClick={() => {
                                markChatSelection(room.roomId, latestThreadKey)
                                setOptimisticRoomId(room.roomId)
                            }}
                            className={linkClassName}
                        >
                            {content}
                        </Link>
                    )
                }
                return (
                    <Link
                        key={room.roomId}
                        to="/rooms/$roomId"
                        params={{ roomId: room.roomId }}
                        onMouseEnter={() => prefetchRoomSidebar(room.roomId)}
                        onFocus={() => prefetchRoomSidebar(room.roomId)}
                        onClick={() => {
                            setOptimisticRoomId(room.roomId)
                        }}
                        className={linkClassName}
                    >
                        {content}
                    </Link>
                )
            })}
        </div>
    )
}
