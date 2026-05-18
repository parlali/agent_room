import { rename, rm, stat, writeFile } from 'node:fs/promises'
import type { RoomFileChangedPayload, RoomFileChangeOperation } from '../rooms/execution-types'
import type { RoomFileSurface } from '../rooms/file-store'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import { currentToolRunContext } from './tool-run-context'
import { isRecord } from './runtime-redaction'
import { runtimeEventLogPayload } from './runtime-event-payload'
import { hiddenStoreRoots, visibleRoomRelativePath } from './room-visible-paths'

type RuntimeEventAppenderInput = {
    config: PiRuntimeConfig
    redactPayload: (payload: unknown) => unknown
    broadcast: (sessionKey: string, event: string, payload: unknown) => void
}

const maxRuntimeEventLogBytes = 5 * 1024 * 1024
const runtimeEventLogRotations = 3

export function createRuntimeEventAppender(input: RuntimeEventAppenderInput) {
    let runtimeEventSeq = 0
    let rotationQueue = Promise.resolve()

    return async function appendRuntimeEvent(event: string, payload: unknown): Promise<void> {
        const runContext = currentToolRunContext()
        const payloadObject = isRecord(payload) ? payload : {}
        const sessionKey =
            runContext?.sessionKey ??
            (typeof payloadObject.sessionKey === 'string' ? payloadObject.sessionKey : null)
        const runId =
            runContext?.runId ??
            (typeof payloadObject.runId === 'string' ? payloadObject.runId : null)
        const redactedPayload = runtimeEventLogPayload(event, input.redactPayload(payload))
        rotationQueue = rotationQueue.then(() =>
            rotateRuntimeEventLog(input.config.paths.runtimeEventsPath),
        )
        await rotationQueue
        await writeFile(
            input.config.paths.runtimeEventsPath,
            `${JSON.stringify({
                ts: Date.now(),
                seq: ++runtimeEventSeq,
                event,
                sessionKey,
                runId,
                payload: redactedPayload,
            })}\n`,
            {
                encoding: 'utf8',
                flag: 'a',
                mode: 0o600,
            },
        )
        const fileChanged = roomFileChangedPayload({
            config: input.config,
            payload,
            sessionKey,
            runId,
        })
        if (fileChanged) {
            input.broadcast(sessionKey ?? '__room__', 'room.files.changed', fileChanged)
        }
    }
}

async function rotateRuntimeEventLog(path: string): Promise<void> {
    let currentSize = 0
    try {
        currentSize = (await stat(path)).size
    } catch {
        return
    }
    if (currentSize < maxRuntimeEventLogBytes) {
        return
    }
    await rm(`${path}.${runtimeEventLogRotations}`, { force: true })
    for (let index = runtimeEventLogRotations - 1; index >= 1; index -= 1) {
        await renameIfExists(`${path}.${index}`, `${path}.${index + 1}`)
    }
    await renameIfExists(path, `${path}.1`)
}

async function renameIfExists(from: string, to: string): Promise<void> {
    try {
        await rename(from, to)
    } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
            return
        }
        throw error
    }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && 'code' in error
}

function normalizeFileChangeOperation(value: unknown): RoomFileChangeOperation {
    if (
        value === 'write' ||
        value === 'edit' ||
        value === 'artifact_import' ||
        value === 'artifact_export' ||
        value === 'upload'
    ) {
        return value
    }
    return 'runtime_activity'
}

function normalizeFileSurface(value: unknown): RoomFileSurface {
    return value === 'store' ? 'store' : 'workspace'
}

function normalizeVisibleRelativePath(input: {
    config: PiRuntimeConfig
    surface: RoomFileSurface
    path: unknown
}): string | null {
    return visibleRoomRelativePath({
        config: input.config,
        surface: input.surface,
        path: input.path,
        hiddenStoreRootNames: hiddenStoreRoots,
    })
}

function roomFileChangedPayload(input: {
    config: PiRuntimeConfig
    payload: unknown
    sessionKey: string | null
    runId: string | null
}): RoomFileChangedPayload | null {
    const payload = isRecord(input.payload) ? input.payload : null
    const fileChange = isRecord(payload?.fileChange) ? payload.fileChange : null
    if (!fileChange) {
        return null
    }
    const surface = normalizeFileSurface(fileChange.root ?? payload?.root)
    const relativePath = normalizeVisibleRelativePath({
        config: input.config,
        surface,
        path: fileChange.path ?? payload?.path,
    })
    if (!relativePath) {
        return null
    }
    return {
        roomId: input.config.runtime.roomId,
        sessionKey: input.sessionKey,
        runId: input.runId,
        surface,
        relativePath,
        operation: normalizeFileChangeOperation(fileChange.kind),
        byteLength:
            typeof fileChange.byteLength === 'number' && Number.isFinite(fileChange.byteLength)
                ? fileChange.byteLength
                : null,
        changedAt: Date.now(),
    }
}
