import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
    emptyRoomMemory,
    hashRoomMemory,
    maintainMemory,
    roomMemorySchema,
    type RoomMemory,
} from '../pi-runtime/memory'
import { getRoomPaths } from './room-paths'

export interface RoomMemorySnapshot {
    path: string
    memory: RoomMemory
    hash: string
    updatedAt: string | null
}

function memoryPath(roomId: string): string {
    return join(getRoomPaths(roomId).engineStateDir, 'internal-state', 'memory.json')
}

async function writeMemory(path: string, memory: RoomMemory): Promise<void> {
    await mkdir(dirname(path), {
        recursive: true,
        mode: 0o700,
    })
    const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`
    await writeFile(tempPath, `${JSON.stringify(memory, null, 4)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
    })
    await rename(tempPath, path)
}

function isNotFoundError(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        String((error as { code: unknown }).code) === 'ENOENT'
    )
}

export async function readRoomMemory(roomId: string): Promise<RoomMemorySnapshot> {
    const path = memoryPath(roomId)
    let raw: string | null = null
    try {
        raw = await readFile(path, 'utf8')
    } catch (error) {
        if (!isNotFoundError(error)) {
            throw error
        }
        const memory = emptyRoomMemory()
        await writeMemory(path, memory)
        return {
            path,
            memory,
            hash: hashRoomMemory(memory),
            updatedAt: null,
        }
    }
    const parsed = roomMemorySchema.safeParse(JSON.parse(raw))
    if (!parsed.success) {
        throw new Error(`Room memory is invalid: ${parsed.error.message}`)
    }
    const maintained = maintainMemory(parsed.data)
    if (maintained.changed) {
        await writeMemory(path, maintained.memory)
    }
    return {
        path,
        memory: maintained.memory,
        hash: hashRoomMemory(maintained.memory),
        updatedAt: (await stat(path)).mtime.toISOString(),
    }
}

export async function updateRoomMemory(input: {
    roomId: string
    memory: unknown
    expectedHash?: string | null
}): Promise<RoomMemorySnapshot> {
    const current = await readRoomMemory(input.roomId)
    if (input.expectedHash && current.hash !== input.expectedHash) {
        throw new Error('Room memory changed before update; reload it and apply your edit again')
    }
    const parsed = roomMemorySchema.safeParse(input.memory)
    if (!parsed.success) {
        throw new Error(`Room memory is invalid: ${parsed.error.message}`)
    }
    const path = memoryPath(input.roomId)
    const maintained = maintainMemory(parsed.data).memory
    await writeMemory(path, maintained)
    return readRoomMemory(input.roomId)
}
