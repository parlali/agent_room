import { roomRepository } from '../db/repositories'
import { roomRuntimeManager } from './runtime-manager'

let startupReconcilePromise: Promise<void> | null = null

async function reconcileDesiredRunningRooms(): Promise<void> {
    const rooms = await roomRepository.listRooms()
    for (const room of rooms) {
        const needsStoppedReconcile =
            room.desiredState === 'stopped' &&
            (room.status === 'running' || room.status === 'starting' || room.status === 'degraded')
        const needsRunningReconcile =
            room.desiredState === 'running' &&
            (room.status === 'setup_required' ||
                room.status === 'stopped' ||
                room.status === 'failed')
        if (!needsStoppedReconcile && !needsRunningReconcile) {
            continue
        }
        try {
            await roomRuntimeManager.reconcileRoom(room.id, null)
        } catch (error) {
            console.error(
                `Failed to reconcile runtime for room ${room.id}`,
                error instanceof Error ? error.message : error,
            )
        }
    }
}

export function ensureRuntimeSupervisorBoot(): Promise<void> {
    if (startupReconcilePromise) {
        return startupReconcilePromise
    }

    startupReconcilePromise = reconcileDesiredRunningRooms()
    return startupReconcilePromise
}

export function __resetRuntimeSupervisorBootForTests(): void {
    startupReconcilePromise = null
}
