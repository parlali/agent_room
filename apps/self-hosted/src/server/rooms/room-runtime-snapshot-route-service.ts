import { setResponseHeaders } from '@tanstack/react-start/server'
import {
    ensureRuntimeSupervisorBoot,
    requireAuthenticatedActor,
    requireRoomOwner,
    syncRoomOnboarding,
} from './room-runtime-route-service'

export async function getRoomExecutionForRoute(data: {
    roomId: string
    selectedThreadKey?: string | null
    messageLimit?: number
}) {
    const actor = await requireAuthenticatedActor()
    setResponseHeaders({
        'cache-control': 'no-store',
    })
    await requireRoomOwner(actor, data.roomId)
    await ensureRuntimeSupervisorBoot()
    await syncRoomOnboarding(data.roomId)
    const { getRoomExecutionSnapshot } = await import('#/server/rooms/execution-engine')
    return getRoomExecutionSnapshot({
        roomId: data.roomId,
        selectedThreadKey: data.selectedThreadKey ?? null,
        messageLimit: data.messageLimit,
        actorUserId: actor.userId,
    })
}

export async function getRoomSidebarForRoute(data: { roomId: string }) {
    const snapshot = await getRoomExecutionForRoute({
        roomId: data.roomId,
        selectedThreadKey: null,
        messageLimit: 0,
    })
    return {
        room: snapshot.room,
        setup: snapshot.setup,
        executionState: snapshot.executionState,
        executionMessage: snapshot.executionMessage,
        threads: snapshot.threads,
        recentActivity: snapshot.recentActivity,
    }
}

export async function getRoomSessionShellForRoute(data: { roomId: string; sessionKey: string }) {
    const snapshot = await getRoomExecutionForRoute({
        roomId: data.roomId,
        selectedThreadKey: data.sessionKey,
        messageLimit: 0,
    })
    const selectedThread =
        snapshot.threads.find((thread) => thread.key === snapshot.selectedThreadKey) ?? null
    return {
        room: snapshot.room,
        setup: snapshot.setup,
        executionState: snapshot.executionState,
        executionMessage: snapshot.executionMessage,
        capabilities: snapshot.capabilities,
        roomAgent: snapshot.roomAgent,
        threads: snapshot.threads,
        selectedThreadKey: snapshot.selectedThreadKey,
        selectedThread,
        selectedThreadModel: snapshot.selectedThreadModel,
        recentActivity: snapshot.recentActivity,
        browserSession: snapshot.browserSession ?? null,
    }
}
