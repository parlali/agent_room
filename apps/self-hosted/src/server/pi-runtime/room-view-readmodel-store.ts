import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import {
    roomViewThreadRelativePath,
    roomViewThreadsRelativePath,
    type RoomViewThreadReadModel,
    type RoomViewThreadsReadModel,
} from '../rooms/room-view-readmodel-contract'
import { serializeJsonFile, writeJsonFile } from './runtime-files'

interface RoomViewReadModelPersistOptions {
    skipIfUnchanged?: boolean
}

interface RoomViewReadModelStore {
    persistThreads: (
        view: RoomViewThreadsReadModel,
        options?: RoomViewReadModelPersistOptions,
    ) => Promise<void>
    persistThread: (
        threadKey: string,
        model: RoomViewThreadReadModel,
        options?: RoomViewReadModelPersistOptions,
    ) => Promise<void>
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

    async function readFileOrNull(path: string): Promise<string | null> {
        try {
            return await readFile(path, 'utf8')
        } catch {
            return null
        }
    }

    async function persist(
        relativePath: string,
        value: unknown,
        context: string,
        options: RoomViewReadModelPersistOptions,
    ): Promise<void> {
        try {
            const path = absolutePath(relativePath)
            if (options.skipIfUnchanged) {
                const existing = await readFileOrNull(path)
                if (existing !== null && existing === serializeJsonFile(value)) {
                    return
                }
            }
            await mkdir(dirname(path), { recursive: true })
            await writeJsonFile(path, value)
            await input.stateSync.upsert(path)
        } catch (error) {
            input.onError(context, error)
        }
    }

    return {
        async persistThreads(view, options = {}) {
            await persist(roomViewThreadsRelativePath, view, 'room view threads', options)
        },
        async persistThread(threadKey, model, options = {}) {
            await persist(roomViewThreadRelativePath(threadKey), model, 'room view thread', options)
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
