import { randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { access, chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import { createHostedRuntimeStateSync } from './hosted-runtime-state-sync'
import { renderMemoryBrief } from './memory-brief'
import { maintainMemory } from './memory-maintenance'
import {
    canonicalMemoryJson,
    emptyRoomMemory,
    hashRoomMemory,
    maxMemoryBytes,
    memoryPath,
    roomMemorySchema,
    runLedgerPath,
    sectionItems,
    type MemoryItem,
    type MemoryPatch,
    type MemorySnapshot,
    type RoomMemory,
} from './memory-model'
import { applyMemoryPatch } from './memory-patch'

async function exists(path: string): Promise<boolean> {
    try {
        await access(path, fsConstants.F_OK)
        return true
    } catch {
        return false
    }
}

async function writeJsonAtomically(path: string, value: RoomMemory): Promise<void> {
    const json = canonicalMemoryJson(value)
    const byteLength = Buffer.byteLength(json)
    if (byteLength > maxMemoryBytes) {
        throw new Error(`memory.json is ${byteLength} bytes; hard cap is ${maxMemoryBytes} bytes`)
    }
    await mkdir(dirname(path), {
        recursive: true,
        mode: 0o700,
    })
    const tempPath = `${path}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
    await writeFile(tempPath, json, {
        encoding: 'utf8',
        mode: 0o600,
    })
    await rename(tempPath, path)
    await chmod(path, 0o600)
}

async function syncMemoryState(config: PiRuntimeConfig): Promise<void> {
    await createHostedRuntimeStateSync(config).upsert(memoryPath(config))
}

function itemFromText(text: string, source: string, priority = 3): MemoryItem {
    return {
        id: randomUUID(),
        text: text.trim(),
        createdAt: new Date().toISOString(),
        source,
        priority,
    }
}

function markdownLinesToItems(markdown: string, source: string): MemoryItem[] {
    return markdown
        .split(/\r?\n/)
        .map((line) =>
            line
                .replace(/^[-*]\s+\[[ x]\]\s+/i, '')
                .replace(/^[-*]\s+/, '')
                .trim(),
        )
        .filter((line) => line && !line.startsWith('#'))
        .slice(0, 20)
        .map((line) => itemFromText(line, source))
}

async function migrateLegacyMarkdown(config: PiRuntimeConfig): Promise<RoomMemory> {
    const memory = emptyRoomMemory()
    const legacy = [
        {
            file: 'memory.md',
            section: 'doNotForget' as const,
            source: 'legacy-memory',
        },
        {
            file: 'plan.md',
            section: 'currentWork.context' as const,
            source: 'legacy-plan',
        },
        {
            file: 'tasks.md',
            section: 'currentWork.goals' as const,
            source: 'legacy-tasks',
        },
        {
            file: 'decisions.md',
            section: 'decisions' as const,
            source: 'legacy-decisions',
        },
    ]

    for (const entry of legacy) {
        const path = join(config.paths.internalStateDir, entry.file)
        if (!(await exists(path))) {
            continue
        }
        const items = markdownLinesToItems(await readFile(path, 'utf8'), entry.source)
        const target = sectionItems(memory, entry.section)
        target.push(...items)
    }

    return maintainMemory(memory).memory
}

export async function ensureMemory(config: PiRuntimeConfig): Promise<MemorySnapshot> {
    await mkdir(config.paths.internalStateDir, {
        recursive: true,
        mode: 0o700,
    })
    await mkdir(runLedgerPath(config), {
        recursive: true,
        mode: 0o700,
    })
    const path = memoryPath(config)
    if (!(await exists(path))) {
        await writeJsonAtomically(path, await migrateLegacyMarkdown(config))
        try {
            await syncMemoryState(config)
        } catch (error) {
            console.warn(
                'Initial memory state sync failed during runtime boot; it will persist on the next update',
                error instanceof Error ? error.message : error,
            )
        }
    }
    return readMemory(config)
}

export async function readMemory(config: PiRuntimeConfig): Promise<MemorySnapshot> {
    const path = memoryPath(config)
    const raw = await readFile(path, 'utf8')
    const parsed = roomMemorySchema.safeParse(JSON.parse(raw))
    if (!parsed.success) {
        throw new Error(`memory.json failed schema validation: ${parsed.error.message}`)
    }
    const maintained = maintainMemory(parsed.data)
    if (maintained.changed) {
        await writeJsonAtomically(path, maintained.memory)
        try {
            await syncMemoryState(config)
        } catch (error) {
            await writeJsonAtomically(path, parsed.data)
            throw error
        }
    }
    const memory = maintained.memory
    const json = canonicalMemoryJson(memory)
    return {
        memory,
        path,
        byteLength: Buffer.byteLength(json),
        hash: hashRoomMemory(memory),
        brief: renderMemoryBrief(memory),
    }
}

export async function replaceMemory(input: {
    config: PiRuntimeConfig
    memory: unknown
    expectedHash?: string | null
}): Promise<MemorySnapshot> {
    const previous = await ensureMemory(input.config)
    if (input.expectedHash && previous.hash !== input.expectedHash) {
        throw new Error('memory.json changed before update; read it again')
    }
    const parsed = roomMemorySchema.safeParse(input.memory)
    if (!parsed.success) {
        throw new Error(`memory.json failed schema validation: ${parsed.error.message}`)
    }
    const maintained = maintainMemory(parsed.data).memory
    const path = memoryPath(input.config)
    await writeJsonAtomically(path, maintained)
    try {
        await syncMemoryState(input.config)
    } catch (error) {
        await writeJsonAtomically(path, previous.memory)
        throw error
    }
    return readMemory(input.config)
}

export async function patchMemory(input: {
    config: PiRuntimeConfig
    patches: MemoryPatch[]
    expectedHash?: string | null
}): Promise<MemorySnapshot> {
    const snapshot = await ensureMemory(input.config)
    if (input.expectedHash && snapshot.hash !== input.expectedHash) {
        throw new Error('memory.json changed before update; read it again')
    }
    const memory = structuredClone(snapshot.memory)
    for (const patch of input.patches) {
        applyMemoryPatch(memory, patch)
    }
    const maintained = maintainMemory(memory).memory
    const parsed = roomMemorySchema.safeParse(maintained)
    if (!parsed.success) {
        throw new Error(`memory.json failed schema validation: ${parsed.error.message}`)
    }
    const path = memoryPath(input.config)
    await writeJsonAtomically(path, parsed.data)
    try {
        await syncMemoryState(input.config)
    } catch (error) {
        await writeJsonAtomically(path, snapshot.memory)
        throw error
    }
    return readMemory(input.config)
}
