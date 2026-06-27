import { useEffect, useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'

import { cn } from '#/lib/utils'
import { describeRoomState } from '#/domain/state'
import { StatusDot } from '#/components/agent-room'
import type { RoomRuntimeOverview } from '#/domain/room-execution-types'

export function SidebarRoomTree({
    rooms,
    onNavigate,
}: {
    rooms: RoomRuntimeOverview[]
    onNavigate?: () => void
}) {
    const pathname = useRouterState({ select: (s) => s.location.pathname })
    const [optimisticPathname, setOptimisticPathname] = useState<string | null>(null)
    const activePathname = optimisticPathname ?? pathname
    const activeRoomId = activePathname.match(/^\/rooms\/([^/]+)/)?.[1] ?? null

    useEffect(() => {
        if (optimisticPathname === pathname) {
            setOptimisticPathname(null)
        }
    }, [optimisticPathname, pathname])

    if (rooms.length === 0) {
        return (
            <div className="px-2 py-4 text-xs text-muted-foreground">
                No rooms yet. Add your first one below.
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
                return (
                    <Link
                        key={room.roomId}
                        to="/rooms/$roomId"
                        params={{ roomId: room.roomId }}
                        onClick={() => {
                            setOptimisticPathname(`/rooms/${room.roomId}`)
                            onNavigate?.()
                        }}
                        className={cn(
                            'flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-sidebar-accent',
                            activeRoomId === room.roomId
                                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                                : 'text-muted-foreground hover:text-sidebar-accent-foreground',
                        )}
                    >
                        <span className="min-w-0 flex-1 truncate font-medium">
                            {room.displayName}
                        </span>
                        <StatusDot
                            tone={state.tone}
                            pulse={state.tone === 'working'}
                            className="shrink-0"
                        />
                    </Link>
                )
            })}
        </div>
    )
}
