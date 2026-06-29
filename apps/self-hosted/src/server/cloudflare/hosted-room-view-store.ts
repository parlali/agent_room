import type { AgentRoomHostedEnv } from './bindings'
import { readHostedRuntimeStateFileTextOrNull } from './hosted-runtime-state-store'
import {
    roomViewThreadRelativePath,
    roomViewThreadsRelativePath,
    type RoomViewThreadReadModel,
    type RoomViewThreadsReadModel,
} from '../rooms/room-view-readmodel-contract'

async function readRoomViewJson<T>(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    relativePath: string
}): Promise<T | null> {
    const text = await readHostedRuntimeStateFileTextOrNull({
        env: input.env,
        workspaceId: input.workspaceId,
        roomId: input.roomId,
        relativePath: input.relativePath,
    })
    if (text === null) {
        return null
    }
    try {
        return JSON.parse(text) as T
    } catch {
        return null
    }
}

export async function readRoomViewThreads(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
}): Promise<RoomViewThreadsReadModel | null> {
    return readRoomViewJson<RoomViewThreadsReadModel>({
        env: input.env,
        workspaceId: input.workspaceId,
        roomId: input.roomId,
        relativePath: roomViewThreadsRelativePath,
    })
}

export async function readRoomViewThread(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    threadKey: string
}): Promise<RoomViewThreadReadModel | null> {
    return readRoomViewJson<RoomViewThreadReadModel>({
        env: input.env,
        workspaceId: input.workspaceId,
        roomId: input.roomId,
        relativePath: roomViewThreadRelativePath(input.threadKey),
    })
}
