import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import {
    roomViewThreadRelativePath,
    roomViewThreadsRelativePath,
    type RoomViewThreadReadModel,
    type RoomViewThreadsReadModel,
} from '../rooms/room-view-readmodel-contract'
import { writeJsonFile } from './runtime-files'

interface RoomViewReadModelStore {
    persistThreads: (view: RoomViewThreadsReadModel) => Promise<void>
    persistThread: (threadKey: string, model: RoomViewThreadReadModel) => Promise<void>
    removeThread: (threadKey: string) => Promise<void>
}

interface RoomViewReadModelStoreInput {
    config: PiRuntimeConfig
    stateSync: {
        upsert: (path: string) => Promise<void>
        delete: (path: string) => Promise<void>
    }
    onError: (context: string, error: unknown) => void
}

export function createRoomViewReadModelStore(
    input: RoomViewReadModelStoreInput,
): RoomViewReadModelStore {
    const baseDir = input.config.paths.stateDir

    function absolutePath(relativePath: string): string {
        return `${baseDir}/${relativePath}`
    }

    async function persist(relativePath: string, value: unknown, context: string): Promise<void> {
        try {
            const path = absolutePath(relativePath)
            await mkdir(dirname(path), { recursive: true })
            await writeJsonFile(path, value)
            await input.stateSync.upsert(path)
        } catch (error) {
            input.onError(context, error)
        }
    }

    return {
        async persistThreads(view) {
            await persist(roomViewThreadsRelativePath, view, 'room view threads')
        },
        async persistThread(threadKey, model) {
            await persist(roomViewThreadRelativePath(threadKey), model, 'room view thread')
        },
        async removeThread(threadKey) {
            try {
                await input.stateSync.delete(absolutePath(roomViewThreadRelativePath(threadKey)))
            } catch (error) {
                input.onError('room view thread delete', error)
            }
        },
    }
}
