import type { AgentRoomHostedEnv } from './bindings'
import type { HostedActor } from './hosted-auth'
import {
    canonicalMemoryJson,
    emptyRoomMemory,
    hashRoomMemory,
    maintainMemory,
    roomMemorySchema,
    type RoomMemory,
} from '../pi-runtime/memory'
import {
    putHostedRuntimeStateFile,
    readHostedRuntimeStateFileTextOrNull,
} from './hosted-runtime-state-store'
import { requestHostedPiRuntime } from './hosted-runtime-client'
import { getHostedRuntimeEndpointState } from './hosted-room-store'
import { memorySnapshotSchema } from '../rooms/pi-execution-adapter/runtime-schemas'

const hostedMemoryRelativePath = 'internal-state/memory.json'

export interface HostedRoomMemorySnapshot {
    memory: RoomMemory
    hash: string
    updatedAt: string | null
}

async function assertHostedRoomExists(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
}): Promise<void> {
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT id
            FROM hosted_room
            WHERE workspace_id = ?1
              AND id = ?2
            LIMIT 1
        `,
    )
        .bind(input.workspaceId, input.roomId)
        .first<{ id: string }>()
    if (!row) {
        throw new Error('Room not found')
    }
}

async function writeHostedMemory(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    memory: RoomMemory
}): Promise<void> {
    await putHostedRuntimeStateFile({
        env: input.env,
        workspaceId: input.workspaceId,
        roomId: input.roomId,
        relativePath: hostedMemoryRelativePath,
        content: new TextEncoder().encode(canonicalMemoryJson(input.memory)),
    })
}

async function writeLiveHostedMemory(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    memory: RoomMemory
    expectedHash: string
}): Promise<HostedRoomMemorySnapshot | null> {
    const endpoint = await getHostedRuntimeEndpointState({
        env: input.env,
        workspaceId: input.workspaceId,
        roomId: input.roomId,
    })
    if (
        !endpoint ||
        endpoint.desiredState !== 'running' ||
        endpoint.status === 'stopped' ||
        endpoint.runtime.healthStatus !== 'healthy' ||
        !endpoint.runtime.tokenObjectKey
    ) {
        return null
    }
    const saved = await requestHostedPiRuntime({
        env: input.env,
        workspaceId: input.workspaceId,
        roomId: input.roomId,
        path: '/memory',
        method: 'POST',
        body: {
            memory: input.memory,
            expectedHash: input.expectedHash,
        },
        schema: memorySnapshotSchema,
    })
    const parsed = roomMemorySchema.parse(saved.memory)
    return {
        memory: parsed,
        hash: saved.hash,
        updatedAt: new Date().toISOString(),
    }
}

export async function getHostedRoomMemory(input: {
    env: AgentRoomHostedEnv
    actor: HostedActor
    roomId: string
}): Promise<HostedRoomMemorySnapshot> {
    await assertHostedRoomExists({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        roomId: input.roomId,
    })
    const raw = await readHostedRuntimeStateFileTextOrNull({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        roomId: input.roomId,
        relativePath: hostedMemoryRelativePath,
    })
    if (raw === null) {
        const memory = emptyRoomMemory()
        await writeHostedMemory({
            env: input.env,
            workspaceId: input.actor.workspaceId,
            roomId: input.roomId,
            memory,
        })
        return {
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
        await writeHostedMemory({
            env: input.env,
            workspaceId: input.actor.workspaceId,
            roomId: input.roomId,
            memory: maintained.memory,
        })
    }
    return {
        memory: maintained.memory,
        hash: hashRoomMemory(maintained.memory),
        updatedAt: null,
    }
}

export async function updateHostedRoomMemory(input: {
    env: AgentRoomHostedEnv
    actor: HostedActor
    roomId: string
    memory: unknown
    expectedHash?: string | null
}): Promise<HostedRoomMemorySnapshot> {
    const current = await getHostedRoomMemory(input)
    if (input.expectedHash && input.expectedHash !== current.hash) {
        throw new Error('Room memory changed before save')
    }
    const parsed = roomMemorySchema.safeParse(input.memory)
    if (!parsed.success) {
        throw new Error(`Room memory is invalid: ${parsed.error.message}`)
    }
    const memory = maintainMemory(parsed.data).memory
    const live = await writeLiveHostedMemory({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        roomId: input.roomId,
        memory,
        expectedHash: current.hash,
    })
    if (live) {
        return live
    }
    await writeHostedMemory({
        env: input.env,
        workspaceId: input.actor.workspaceId,
        roomId: input.roomId,
        memory,
    })
    return {
        memory,
        hash: hashRoomMemory(memory),
        updatedAt: new Date().toISOString(),
    }
}
