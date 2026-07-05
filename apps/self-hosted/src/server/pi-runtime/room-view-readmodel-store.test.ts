import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import type { RoomViewThreadsReadModel } from '../rooms/room-view-readmodel-contract'
import { createRoomViewReadModelStore } from './room-view-readmodel-store'

function makeConfig(stateDir: string): PiRuntimeConfig {
    return {
        paths: { stateDir },
        runtime: { roomId: 'room-test' },
    } as unknown as PiRuntimeConfig
}

function makeView(label: string): RoomViewThreadsReadModel {
    return {
        roomAgent: { id: label },
        threads: [],
        extraAgentIds: [],
    } as unknown as RoomViewThreadsReadModel
}

describe('createRoomViewReadModelStore skipIfUnchanged', () => {
    let stateDir: string
    let upserts: string[]

    beforeEach(async () => {
        stateDir = await mkdtemp(join(tmpdir(), 'readmodel-store-'))
        upserts = []
    })

    afterEach(async () => {
        await rm(stateDir, { recursive: true, force: true })
    })

    function makeStore() {
        return createRoomViewReadModelStore({
            config: makeConfig(stateDir),
            stateSync: {
                upsert: async (path: string) => {
                    upserts.push(path)
                },
                delete: async () => {},
            },
            onError: (_context, error) => {
                throw error instanceof Error ? error : new Error(String(error))
            },
        })
    }

    it('skips the upsert when the on-disk content is unchanged', async () => {
        const store = makeStore()
        const view = makeView('a')

        await store.persistThreads(view)
        expect(upserts).toHaveLength(1)

        await store.persistThreads(view, { skipIfUnchanged: true })
        expect(upserts).toHaveLength(1)
    })

    it('still upserts when the content changed since the last sync', async () => {
        const store = makeStore()

        await store.persistThreads(makeView('a'))
        expect(upserts).toHaveLength(1)

        await store.persistThreads(makeView('b'), { skipIfUnchanged: true })
        expect(upserts).toHaveLength(2)
    })

    it('upserts when skipIfUnchanged is set but the file does not exist yet', async () => {
        const store = makeStore()

        await store.persistThreads(makeView('a'), { skipIfUnchanged: true })
        expect(upserts).toHaveLength(1)
    })
})
