import { rename, rm, stat, writeFile } from 'node:fs/promises'
import type { RoomFileChangedPayload, RoomFileChangeOperation } from '../rooms/execution-types'
import type { RoomFileSurface } from '../rooms/file-store'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import { roomFileUploadPolicy } from '#/domain/room-file-upload-policy'
import { resolveRoomFilePathInsideRoot } from '../rooms/file-paths'
import { currentToolRunContext } from './tool-run-context'
import { isRecord } from './runtime-redaction'
import { runtimeEventLogPayload } from './runtime-event-payload'
import { visibleRoomRelativePath } from './room-visible-paths'
import { readVisibleFileNoFollow } from './visible-file-access'
import {
    hostedRuntimeFileCallbackUrlEnvKey,
    hostedRuntimeStateCallbackUrlEnvKey,
    hostedRuntimeUsageCallbackTokenEnvKey,
    hostedRuntimeUsageCallbackUrlEnvKey,
    hostedRuntimeWorkspaceIdEnvKey,
} from '../rooms/pi-runtime-contract'
import { createHostedRuntimeStateSync } from './hosted-runtime-state-sync'
import { postHostedRuntimeCallback } from './hosted-runtime-callback'
import { installHostedProviderReservationFetchRecorder } from './hosted-provider-reservation-context'

type RuntimeEventAppenderInput = {
    config: PiRuntimeConfig
    redactPayload: (payload: unknown) => unknown
    broadcast: (sessionKey: string, event: string, payload: unknown) => void
}

const maxRuntimeEventLogBytes = 5 * 1024 * 1024
const runtimeEventLogRotations = 3
const hostedUsageCallbackDrainTimeoutMs = 10_000

const pendingHostedUsageCallbacks = new Set<Promise<void>>()

function hostedRuntimeUsageCallbackRequired(event: string): boolean {
    return event === 'run.finished' || event === 'provider.finished'
}

export function drainPendingHostedRuntimeUsage(): Promise<void> {
    const pending = [...pendingHostedUsageCallbacks]
    if (pending.length === 0) {
        return Promise.resolve()
    }
    const drain = Promise.allSettled(pending).then(() => undefined)
    const timeout = new Promise<void>((done) => {
        setTimeout(() => {
            console.warn(
                `drainPendingHostedRuntimeUsage timed out with ${pendingHostedUsageCallbacks.size} callbacks still pending`,
            )
            done()
        }, hostedUsageCallbackDrainTimeoutMs).unref()
    })
    return Promise.race([drain, timeout])
}

export function createRuntimeEventAppender(input: RuntimeEventAppenderInput) {
    let runtimeEventSeq = 0
    let rotationQueue = Promise.resolve()
    const hostedUsageCallbackUrl = process.env[hostedRuntimeUsageCallbackUrlEnvKey] ?? null
    const hostedFileCallbackUrl = process.env[hostedRuntimeFileCallbackUrlEnvKey] ?? null
    const hostedStateCallbackUrl = process.env[hostedRuntimeStateCallbackUrlEnvKey] ?? null
    const hostedUsageCallbackToken = process.env[hostedRuntimeUsageCallbackTokenEnvKey] ?? null
    const hostedWorkspaceId = process.env[hostedRuntimeWorkspaceIdEnvKey] ?? null
    const hostedStateSync =
        hostedStateCallbackUrl && hostedUsageCallbackToken && hostedWorkspaceId
            ? createHostedRuntimeStateSync(input.config)
            : null
    if (hostedUsageCallbackUrl && hostedUsageCallbackToken && hostedWorkspaceId) {
        installHostedProviderReservationFetchRecorder()
    }

    return async function appendRuntimeEvent(event: string, payload: unknown): Promise<void> {
        const runContext = currentToolRunContext()
        const payloadObject = isRecord(payload) ? payload : {}
        const sessionKey =
            runContext?.sessionKey ??
            (typeof payloadObject.sessionKey === 'string' ? payloadObject.sessionKey : null)
        const runId =
            runContext?.runId ??
            (typeof payloadObject.runId === 'string' ? payloadObject.runId : null)
        const jobId =
            runContext?.jobId ??
            (typeof payloadObject.jobId === 'string' ? payloadObject.jobId : null)
        const redactedPayload = runtimeEventLogPayload(event, input.redactPayload(payload))
        const fileChanged = roomFileChangedPayload({
            config: input.config,
            payload,
            sessionKey,
            runId,
        })
        if (fileChanged && hostedFileCallbackUrl && hostedUsageCallbackToken && hostedWorkspaceId) {
            await postHostedRuntimeFileChanged({
                url: hostedFileCallbackUrl,
                token: hostedUsageCallbackToken,
                workspaceId: hostedWorkspaceId,
                roomId: input.config.runtime.roomId,
                config: input.config,
                fileChanged,
            })
        }
        rotationQueue = rotationQueue.then(() =>
            rotateRuntimeEventLog(input.config.paths.runtimeEventsPath),
        )
        await rotationQueue
        const entry = {
            ts: Date.now(),
            seq: ++runtimeEventSeq,
            event,
            sessionKey,
            runId,
            jobId,
            payload: redactedPayload,
        }
        await writeFile(input.config.paths.runtimeEventsPath, `${JSON.stringify(entry)}\n`, {
            encoding: 'utf8',
            flag: 'a',
            mode: 0o600,
        })
        void hostedStateSync
            ?.upsert(input.config.paths.runtimeEventsPath)
            ?.catch((error) => {
                console.warn(
                    'Hosted runtime event log sync failed',
                    error instanceof Error ? error.message : error,
                )
            })
        if (hostedUsageCallbackUrl && hostedUsageCallbackToken && hostedWorkspaceId) {
            const callbackPromise = postHostedRuntimeUsage({
                url: hostedUsageCallbackUrl,
                token: hostedUsageCallbackToken,
                workspaceId: hostedWorkspaceId,
                roomId: input.config.runtime.roomId,
                entry,
            })
            if (hostedRuntimeUsageCallbackRequired(event)) {
                await callbackPromise
            } else {
                pendingHostedUsageCallbacks.add(callbackPromise)
                void callbackPromise
                    .catch((error) => {
                        console.warn(
                            'Hosted runtime usage callback failed',
                            error instanceof Error ? error.message : error,
                        )
                    })
                    .finally(() => {
                        pendingHostedUsageCallbacks.delete(callbackPromise)
                    })
            }
        }
        if (fileChanged) {
            input.broadcast(sessionKey ?? '__room__', 'room.files.changed', fileChanged)
        }
    }
}

async function postHostedRuntimeUsage(input: {
    url: string
    token: string
    workspaceId: string
    roomId: string
    entry: unknown
}): Promise<void> {
    await postHostedRuntimeCallback({
        url: input.url,
        token: input.token,
        label: 'Hosted runtime usage',
        body: {
            workspaceId: input.workspaceId,
            roomId: input.roomId,
            entry: input.entry,
        },
    })
}

function visibleFilePath(input: {
    config: PiRuntimeConfig
    surface: RoomFileSurface
    relativePath: string
}): string {
    return resolveRoomFilePathInsideRoot({
        root:
            input.surface === 'workspace'
                ? input.config.paths.workspaceDir
                : input.config.paths.storeDir,
        relativePath: input.relativePath,
        boundaryErrorMessage: 'Runtime file callback path escapes the room boundary',
    })
}

async function runtimeFileContent(input: {
    config: PiRuntimeConfig
    fileChanged: RoomFileChangedPayload
}): Promise<{
    contentBase64: string
    byteLength: number
}> {
    if (!input.fileChanged.relativePath) {
        throw new Error('Runtime file callback relative path is missing')
    }
    const path = visibleFilePath({
        config: input.config,
        surface: input.fileChanged.surface,
        relativePath: input.fileChanged.relativePath,
    })
    const read = await readVisibleFileNoFollow({
        root:
            input.fileChanged.surface === 'workspace'
                ? input.config.paths.workspaceDir
                : input.config.paths.storeDir,
        path,
        maxBytes: roomFileUploadPolicy.maxBytesPerFile,
    })
    return {
        contentBase64: read.content.toString('base64url'),
        byteLength: read.byteLength,
    }
}

async function postHostedRuntimeFileChanged(input: {
    url: string
    token: string
    workspaceId: string
    roomId: string
    config: PiRuntimeConfig
    fileChanged: RoomFileChangedPayload
}): Promise<void> {
    const content = await runtimeFileContent({
        config: input.config,
        fileChanged: input.fileChanged,
    })
    await postHostedRuntimeCallback({
        url: input.url,
        token: input.token,
        label: 'Hosted runtime file',
        body: {
            workspaceId: input.workspaceId,
            roomId: input.roomId,
            file: {
                ...input.fileChanged,
                ...content,
            },
        },
    })
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
