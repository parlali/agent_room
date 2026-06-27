import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { defaultPersonalityForm } from '../rooms/personality/form'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import {
    canonicalMemoryJson,
    nowIso,
    type MemorySectionPath,
    type RoomMemory,
} from '#/domain/room-memory'

export {
    canonicalMemoryJson,
    isMemorySectionPath,
    lowPriorityTrimTarget,
    maxMemoryBytes,
    maxSectionItems,
    memoryGroups,
    memorySectionPaths,
    nowIso,
    roomMemorySchema,
    sectionItems,
    setSectionItems,
    timedSections,
    type MemoryGroupMeta,
    type MemoryItem,
    type MemorySectionMeta,
    type MemorySectionPath,
    type RoomMemory,
    type TimedMemoryItem,
} from '#/domain/room-memory'

export interface MemorySnapshot {
    memory: RoomMemory
    path: string
    byteLength: number
    hash: string
    brief: string
}

export interface MemoryPatch {
    op: 'add' | 'update' | 'remove' | 'complete'
    section: MemorySectionPath
    id?: string
    text?: string
    source?: string
    priority?: number
    tags?: string[]
    dueAt?: string
    expiresAt?: string
    recurrence?: {
        rule: string
        timezone?: string
    }
}

export function memoryPath(config: PiRuntimeConfig): string {
    return join(config.paths.internalStateDir, 'memory.json')
}

export function runLedgerPath(config: PiRuntimeConfig): string {
    return join(config.paths.internalStateDir, 'run-ledger')
}

export function emptyRoomMemory(createdAt = nowIso()): RoomMemory {
    return {
        version: 1,
        identity: {
            role: 'Room-local coworker',
            responsibilities: [],
            boundaries: [],
        },
        operator: {
            facts: [],
            preferences: [],
        },
        behavior: {
            rules: [],
            communication: [],
        },
        currentWork: {
            goals: [],
            projects: [],
            context: [],
        },
        schedule: {
            reminders: [],
            deadlines: [],
            recurring: [],
        },
        decisions: [],
        doNotForget: [
            {
                id: randomUUID(),
                text: 'Keep durable memory concise and never store secrets or raw chat history',
                createdAt,
                source: 'system',
                priority: 5,
                tags: ['safety'],
            },
        ],
        personality: defaultPersonalityForm(),
    }
}

export function hashRoomMemory(memory: RoomMemory): string {
    return createHash('sha256').update(canonicalMemoryJson(memory)).digest('hex')
}
