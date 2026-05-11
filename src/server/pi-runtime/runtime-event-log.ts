import { writeFile } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'
import type { RoomFileChangedPayload, RoomFileChangeOperation } from '../rooms/execution-types'
import type { RoomFileSurface } from '../rooms/file-store'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import { currentToolRunContext } from './tool-run-context'
import { isRecord } from './runtime-redaction'

type RuntimeEventAppenderInput = {
    config: PiRuntimeConfig
    redactPayload: (payload: unknown) => unknown
    broadcast: (sessionKey: string, event: string, payload: unknown) => void
}

const internalStoreRoots = new Set(['blobs', 'manifests', 'previews'])

export function createRuntimeEventAppender(input: RuntimeEventAppenderInput) {
    let runtimeEventSeq = 0

    return async function appendRuntimeEvent(event: string, payload: unknown): Promise<void> {
        const runContext = currentToolRunContext()
        const payloadObject = isRecord(payload) ? payload : {}
        const sessionKey =
            runContext?.sessionKey ??
            (typeof payloadObject.sessionKey === 'string' ? payloadObject.sessionKey : null)
        const runId =
            runContext?.runId ??
            (typeof payloadObject.runId === 'string' ? payloadObject.runId : null)
        const redactedPayload = input.redactPayload(payload)
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

function rootPathForSurface(config: PiRuntimeConfig, surface: RoomFileSurface): string {
    return surface === 'store' ? config.paths.storeDir : config.paths.workspaceDir
}

function normalizeVisibleRelativePath(input: {
    config: PiRuntimeConfig
    surface: RoomFileSurface
    path: unknown
}): string | null {
    if (typeof input.path !== 'string' || !input.path.trim()) {
        return null
    }
    const trimmed = input.path.trim()
    let relativePath = trimmed
    if (isAbsolute(trimmed)) {
        const display = relative(rootPathForSurface(input.config, input.surface), trimmed)
        if (display.startsWith('..') || isAbsolute(display)) {
            return null
        }
        relativePath = display
    }
    relativePath = relativePath
        .split(sep)
        .join('/')
        .replace(/^\.\/+/, '')
    if (!relativePath || relativePath === '.') {
        return null
    }
    if (input.surface === 'store') {
        const root = relativePath.split('/')[0] ?? relativePath
        if (internalStoreRoots.has(root)) {
            return null
        }
    }
    return relativePath
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
