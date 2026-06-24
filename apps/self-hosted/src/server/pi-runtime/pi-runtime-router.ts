import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AgentSession } from '@mariozechner/pi-coding-agent'

import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import type {
    PiRuntimeAbortPayload,
    PiRuntimeCompactPayload,
    PiRuntimeForkPayload,
    PiRuntimeSendPayload,
    PiRuntimeSnapshotPayload,
    PiRuntimeSessionWindowPayload,
    PiRuntimeThreadModelPayload,
    PiRuntimeThreadCreatePayload,
} from './protocol'
import type {
    RoomExecutionSpeedMode,
    RoomExecutionThinkingLevel,
    RoomFileChangedPayload,
    RoomFileChangeOperation,
} from '../rooms/execution-types'
import type { RoomFileSurface } from '../rooms/file-store'
import { resolveAbortDecision } from './run-control'
import { RunWatchdog, timeoutMessage, type RunKind } from './run-budget'
import { assertAuthorized, getRequestBody, HttpError, sendJson } from './runtime-http'
import { isRecord } from './runtime-redaction'
import { isValidSpeedMode } from './runtime-speed-mode'
import type { ThreadKind, ThreadRecord } from './thread-records'
import { cancelReadableStreamReaderInBackground } from '../streams/readable-stream'
import {
    createThreadRuntimeBodySchema,
    sendThreadRuntimeBodySchema,
} from '../rooms/pi-execution-adapter/thread-requests'
import { replaceMemory } from './memory'
import { normalizeRoomFileRelativePath, resolveRoomFilePathInsideRoot } from '../rooms/file-paths'
import {
    deleteVisibleFileNoFollow,
    readVisibleFileNoFollow,
    writeVisibleFileNoFollow,
} from './visible-file-access'

interface RouterActiveThread {
    session: AgentSession
    abortController: AbortController | null
}

function fileSurface(value: unknown): RoomFileSurface | null {
    return value === 'workspace' || value === 'store' ? value : null
}

function normalizedVisibleRelativePath(value: unknown): string {
    if (typeof value !== 'string') {
        throw new HttpError(400, 'File relativePath is required')
    }
    try {
        const relativePath = normalizeRoomFileRelativePath(value)
        if (!relativePath) {
            throw new HttpError(400, 'File relativePath must be relative')
        }
        return relativePath
    } catch (error) {
        if (error instanceof HttpError) {
            throw error
        }
        throw new HttpError(400, 'File relativePath escapes the room boundary')
    }
}

function visibleRoot(config: PiRuntimeConfig, surface: RoomFileSurface): string {
    return surface === 'workspace' ? config.paths.workspaceDir : config.paths.storeDir
}

function visibleFilePath(input: {
    config: PiRuntimeConfig
    surface: RoomFileSurface
    relativePath: string
}): string {
    try {
        return resolveRoomFilePathInsideRoot({
            root: visibleRoot(input.config, input.surface),
            relativePath: input.relativePath,
            boundaryErrorMessage: 'File path escapes the room boundary',
        })
    } catch {
        throw new HttpError(400, 'File path escapes the room boundary')
    }
}

function materializeFileRequestBody(
    config: PiRuntimeConfig,
    body: unknown,
): {
    surface: RoomFileSurface
    relativePath: string
    root: string
    path: string
    content: Buffer
    mode: number
} {
    if (!isRecord(body)) {
        throw new HttpError(400, 'File materialization body must be an object')
    }
    const surface = fileSurface(body.surface)
    if (!surface) {
        throw new HttpError(400, 'File surface is invalid')
    }
    const relativePath = normalizedVisibleRelativePath(body.relativePath)
    if (typeof body.contentBase64 !== 'string') {
        throw new HttpError(400, 'File contentBase64 is required')
    }
    const mode =
        typeof body.mode === 'number' && Number.isInteger(body.mode)
            ? Math.max(0o400, Math.min(body.mode, 0o777))
            : 0o600
    return {
        surface,
        relativePath,
        root: visibleRoot(config, surface),
        path: visibleFilePath({
            config,
            surface,
            relativePath,
        }),
        content: Buffer.from(body.contentBase64, 'base64url'),
        mode,
    }
}

function readVisibleFileRequestBody(
    config: PiRuntimeConfig,
    body: unknown,
): {
    surface: RoomFileSurface
    relativePath: string
    root: string
    path: string
} {
    if (!isRecord(body)) {
        throw new HttpError(400, 'File read body must be an object')
    }
    const surface = fileSurface(body.surface)
    if (!surface) {
        throw new HttpError(400, 'File surface is invalid')
    }
    const relativePath = normalizedVisibleRelativePath(body.relativePath)
    return {
        surface,
        relativePath,
        root: visibleRoot(config, surface),
        path: visibleFilePath({
            config,
            surface,
            relativePath,
        }),
    }
}

function fileChangeOperation(value: unknown): RoomFileChangeOperation {
    if (
        value === 'write' ||
        value === 'edit' ||
        value === 'artifact_import' ||
        value === 'artifact_export' ||
        value === 'upload' ||
        value === 'runtime_activity'
    ) {
        return value
    }
    return 'runtime_activity'
}

function nullableString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null
}

function parseFileChangedPayload(config: PiRuntimeConfig, body: unknown): RoomFileChangedPayload {
    if (!isRecord(body)) {
        throw new HttpError(400, 'File change payload is invalid')
    }
    const surface = fileSurface(body.surface)
    const relativePath = nullableString(body.relativePath)
    if (!surface || !relativePath) {
        throw new HttpError(400, 'File change payload is missing a visible file path')
    }
    return {
        roomId: config.runtime.roomId,
        sessionKey: nullableString(body.sessionKey),
        runId: nullableString(body.runId),
        surface,
        relativePath,
        operation: fileChangeOperation(body.operation),
        byteLength:
            typeof body.byteLength === 'number' && Number.isFinite(body.byteLength)
                ? body.byteLength
                : null,
        changedAt:
            typeof body.changedAt === 'number' && Number.isFinite(body.changedAt)
                ? body.changedAt
                : Date.now(),
    }
}

export function createPiRuntimeRouter({
    config,
    activeThreads,
    findThread,
    createThread,
    runPrompt,
    updateThreadModel,
    renameThread,
    deleteThread,
    compactThread,
    forkThread,
    editThreadMessage,
    snapshot,
    sessionWindow,
    createEventStream,
    createRoomEventStream,
    publishRoomFileChanged,
    persistThreadIndex,
}: {
    config: PiRuntimeConfig
    activeThreads: Map<string, RouterActiveThread>
    findThread: (key: string) => ThreadRecord | null
    createThread: (input: {
        firstMessage?: string | null
        title?: string | null
        internalInstruction?: string | null
        hideUserMessage?: boolean
        awaitInitialRun?: boolean
        kind?: ThreadKind
    }) => Promise<PiRuntimeThreadCreatePayload>
    runPrompt: (input: {
        record: ThreadRecord
        message: string
        runId: string
        awaitCompletion: boolean
        runKind?: RunKind
        jobId?: string | null
        hideUserMessage?: boolean
    }) => Promise<string>
    updateThreadModel: (input: {
        record: ThreadRecord
        provider: string
        model: string
        thinkingLevel?: RoomExecutionThinkingLevel | null
        speedMode?: RoomExecutionSpeedMode | null
    }) => Promise<PiRuntimeThreadModelPayload>
    renameThread: (input: { record: ThreadRecord; title: string }) => Promise<void>
    deleteThread: (record: ThreadRecord) => Promise<void>
    compactThread: (input: {
        record: ThreadRecord
        instructions?: string | null
    }) => Promise<PiRuntimeCompactPayload>
    forkThread: (input: {
        record: ThreadRecord
        title?: string | null
        entryId?: string | null
    }) => Promise<PiRuntimeForkPayload>
    editThreadMessage: (input: {
        record: ThreadRecord
        messageId: string
        message: string
        runId: string
        awaitCompletion: boolean
    }) => Promise<string>
    snapshot: (input: {
        selectedThreadKey?: string | null
        messageLimit?: number
    }) => PiRuntimeSnapshotPayload
    sessionWindow: (input: {
        record: ThreadRecord
        before?: string | null
        after?: string | null
        limitRows?: number
    }) => PiRuntimeSessionWindowPayload
    createEventStream: (sessionKey: string) => ReadableStream<Uint8Array>
    createRoomEventStream: () => ReadableStream<Uint8Array>
    publishRoomFileChanged: (payload: RoomFileChangedPayload) => void
    persistThreadIndex: () => Promise<void>
}) {
    return async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
        const url = new URL(
            request.url ?? '/',
            `http://${config.runtime.bindHost}:${config.runtime.port}`,
        )
        if (url.pathname === '/health') {
            sendJson(response, 200, {
                healthy: true,
                roomId: config.runtime.roomId,
                runtime: 'pi',
            })
            return
        }

        assertAuthorized(request, config.runtime.token)

        if (request.method === 'GET' && url.pathname === '/snapshot') {
            sendJson(
                response,
                200,
                snapshot({
                    selectedThreadKey: url.searchParams.get('selectedThreadKey'),
                    messageLimit: Number(url.searchParams.get('messageLimit') ?? 200),
                }),
            )
            return
        }

        if (request.method === 'POST' && url.pathname === '/memory') {
            const body = await getRequestBody(request)
            if (!isRecord(body)) {
                throw new HttpError(400, 'Invalid memory body')
            }
            const memory = await replaceMemory({
                config,
                memory: body.memory,
                expectedHash:
                    typeof body.expectedHash === 'string' && body.expectedHash.trim()
                        ? body.expectedHash
                        : null,
            })
            sendJson(response, 200, memory)
            return
        }

        const threadWindowMatch = url.pathname.match(/^\/threads\/([^/]+)\/window$/)
        if (request.method === 'GET' && threadWindowMatch) {
            const sessionKey = decodeURIComponent(threadWindowMatch[1]!)
            const record = findThread(sessionKey)
            if (!record) {
                throw new HttpError(404, `Thread ${sessionKey} does not exist`)
            }
            sendJson(
                response,
                200,
                sessionWindow({
                    record,
                    before: url.searchParams.get('before'),
                    after: url.searchParams.get('after'),
                    limitRows: Number(url.searchParams.get('limitRows') ?? 40),
                }),
            )
            return
        }

        if (request.method === 'POST' && url.pathname === '/threads') {
            const parsed = createThreadRuntimeBodySchema.safeParse(await getRequestBody(request))
            if (!parsed.success) {
                throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Invalid thread body')
            }
            const body = parsed.data
            sendJson(
                response,
                200,
                await createThread({
                    firstMessage: body.firstMessage,
                    title: body.title,
                    internalInstruction: body.internalInstruction,
                    hideUserMessage: body.hideUserMessage && body.kind === 'onboarding',
                    awaitInitialRun: body.awaitInitialRun,
                    kind: body.kind,
                }),
            )
            return
        }

        const threadSendMatch = url.pathname.match(/^\/threads\/([^/]+)\/send$/)
        if (request.method === 'POST' && threadSendMatch) {
            const sessionKey = decodeURIComponent(threadSendMatch[1]!)
            const record = findThread(sessionKey)
            if (!record) {
                throw new HttpError(404, `Thread ${sessionKey} does not exist`)
            }
            const parsed = sendThreadRuntimeBodySchema.safeParse(await getRequestBody(request))
            if (!parsed.success) {
                throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Invalid send body')
            }
            const body = parsed.data
            const runId = body.runId ?? randomUUID()
            const hideUserMessage = body.hideUserMessage === true && record.kind === 'onboarding'
            const finalStatus = await runPrompt({
                record,
                message: body.message,
                runId,
                awaitCompletion: body.awaitCompletion,
                runKind: body.runKind,
                jobId: body.jobId,
                hideUserMessage,
            })
            const payload: PiRuntimeSendPayload = {
                runId,
                status: body.awaitCompletion ? finalStatus : 'accepted',
                messageSeq: null,
                interruptedActiveRun: false,
                error: record.lastError,
            }
            sendJson(response, 200, payload)
            return
        }

        const threadModelMatch = url.pathname.match(/^\/threads\/([^/]+)\/model$/)
        if (request.method === 'POST' && threadModelMatch) {
            const sessionKey = decodeURIComponent(threadModelMatch[1]!)
            const record = findThread(sessionKey)
            if (!record) {
                throw new HttpError(404, `Thread ${sessionKey} does not exist`)
            }
            const body = await getRequestBody(request)
            const provider =
                isRecord(body) && typeof body.provider === 'string' ? body.provider : ''
            const model = isRecord(body) && typeof body.model === 'string' ? body.model : ''
            const thinkingLevel =
                isRecord(body) && typeof body.thinkingLevel === 'string'
                    ? (body.thinkingLevel as RoomExecutionThinkingLevel)
                    : null
            const speedMode =
                isRecord(body) && isValidSpeedMode(body.speedMode) ? body.speedMode : null
            sendJson(
                response,
                200,
                await updateThreadModel({
                    record,
                    provider,
                    model,
                    thinkingLevel,
                    speedMode,
                }),
            )
            return
        }

        const threadRenameMatch = url.pathname.match(/^\/threads\/([^/]+)\/rename$/)
        if (request.method === 'POST' && threadRenameMatch) {
            const sessionKey = decodeURIComponent(threadRenameMatch[1]!)
            const record = findThread(sessionKey)
            if (!record) {
                throw new HttpError(404, `Thread ${sessionKey} does not exist`)
            }
            const body = await getRequestBody(request)
            const title = isRecord(body) && typeof body.title === 'string' ? body.title : ''
            await renameThread({ record, title })
            sendJson(response, 200, { ok: true })
            return
        }

        const threadDeleteMatch = url.pathname.match(/^\/threads\/([^/]+)$/)
        if (request.method === 'DELETE' && threadDeleteMatch) {
            const sessionKey = decodeURIComponent(threadDeleteMatch[1]!)
            const record = findThread(sessionKey)
            if (!record) {
                throw new HttpError(404, `Thread ${sessionKey} does not exist`)
            }
            await deleteThread(record)
            sendJson(response, 200, { ok: true })
            return
        }

        const threadAbortMatch = url.pathname.match(/^\/threads\/([^/]+)\/abort$/)
        if (request.method === 'POST' && threadAbortMatch) {
            const sessionKey = decodeURIComponent(threadAbortMatch[1]!)
            const record = findThread(sessionKey)
            if (!record) {
                throw new HttpError(404, `Thread ${sessionKey} does not exist`)
            }
            const body = await getRequestBody(request)
            const requestedRunId =
                isRecord(body) && typeof body.runId === 'string' && body.runId.trim()
                    ? body.runId.trim()
                    : null
            const active = activeThreads.get(sessionKey)
            const abortDecision = resolveAbortDecision({
                requestedRunId,
                activeRunId: record.activeRunId,
            })
            if (!abortDecision.shouldAbort) {
                const payload: PiRuntimeAbortPayload = {
                    abortedRunId: abortDecision.abortedRunId,
                    status: abortDecision.status,
                }
                sendJson(response, 200, payload)
                return
            }
            if (active) {
                active.abortController?.abort(
                    new RunWatchdog('explicit_abort', timeoutMessage('explicit_abort')),
                )
                await active.session.abort()
            }
            record.status = 'idle'
            record.activeRunId = null
            record.activeRunKind = null
            record.runStartedAt = null
            record.runBudgetExpiresAt = null
            record.idleTimeoutExpiresAt = null
            await persistThreadIndex()
            const payload: PiRuntimeAbortPayload = {
                abortedRunId: abortDecision.abortedRunId,
                status: abortDecision.status,
            }
            sendJson(response, 200, payload)
            return
        }

        const threadCompactMatch = url.pathname.match(/^\/threads\/([^/]+)\/compact$/)
        if (request.method === 'POST' && threadCompactMatch) {
            const sessionKey = decodeURIComponent(threadCompactMatch[1]!)
            const record = findThread(sessionKey)
            if (!record) {
                throw new HttpError(404, `Thread ${sessionKey} does not exist`)
            }
            const body = await getRequestBody(request)
            const instructions =
                isRecord(body) && typeof body.instructions === 'string' ? body.instructions : null
            sendJson(
                response,
                200,
                await compactThread({
                    record,
                    instructions,
                }),
            )
            return
        }

        const threadEditMessageMatch = url.pathname.match(
            /^\/threads\/([^/]+)\/messages\/([^/]+)\/edit$/,
        )
        if (request.method === 'POST' && threadEditMessageMatch) {
            const sessionKey = decodeURIComponent(threadEditMessageMatch[1]!)
            const messageId = decodeURIComponent(threadEditMessageMatch[2]!)
            const record = findThread(sessionKey)
            if (!record) {
                throw new HttpError(404, `Thread ${sessionKey} does not exist`)
            }
            const body = await getRequestBody(request)
            const message =
                isRecord(body) && typeof body.message === 'string' ? body.message.trim() : ''
            if (!message) {
                throw new HttpError(400, 'Message cannot be empty')
            }
            const runId = randomUUID()
            const awaitCompletion = isRecord(body) && body.awaitCompletion === true
            const finalStatus = await editThreadMessage({
                record,
                messageId,
                message,
                runId,
                awaitCompletion,
            })
            const payload: PiRuntimeSendPayload = {
                runId,
                status: awaitCompletion ? finalStatus : 'accepted',
                messageSeq: null,
                interruptedActiveRun: false,
                error: record.lastError,
            }
            sendJson(response, 200, payload)
            return
        }

        const threadForkMatch = url.pathname.match(/^\/threads\/([^/]+)\/fork$/)
        if (request.method === 'POST' && threadForkMatch) {
            const sessionKey = decodeURIComponent(threadForkMatch[1]!)
            const record = findThread(sessionKey)
            if (!record) {
                throw new HttpError(404, `Thread ${sessionKey} does not exist`)
            }
            const body = await getRequestBody(request)
            const title = isRecord(body) && typeof body.title === 'string' ? body.title : null
            const entryId = isRecord(body) && typeof body.entryId === 'string' ? body.entryId : null
            const payload: PiRuntimeForkPayload = await forkThread({
                record,
                title,
                entryId,
            })
            sendJson(response, 200, payload)
            return
        }

        const eventsMatch = url.pathname.match(/^\/threads\/([^/]+)\/events$/)
        if (request.method === 'GET' && eventsMatch) {
            const sessionKey = decodeURIComponent(eventsMatch[1]!)
            if (!findThread(sessionKey)) {
                throw new HttpError(404, `Thread ${sessionKey} does not exist`)
            }
            response.writeHead(200, {
                'content-type': 'text/event-stream; charset=utf-8',
                'cache-control': 'no-store',
                connection: 'keep-alive',
            })
            const reader = createEventStream(sessionKey).getReader()
            request.on('close', () => {
                cancelReadableStreamReaderInBackground(reader)
            })
            while (true) {
                const next = await reader.read()
                if (next.done) {
                    response.end()
                    return
                }
                response.write(next.value)
            }
        }

        if (request.method === 'GET' && url.pathname === '/events') {
            response.writeHead(200, {
                'content-type': 'text/event-stream; charset=utf-8',
                'cache-control': 'no-store',
                connection: 'keep-alive',
            })
            const reader = createRoomEventStream().getReader()
            request.on('close', () => {
                cancelReadableStreamReaderInBackground(reader)
            })
            while (true) {
                const next = await reader.read()
                if (next.done) {
                    response.end()
                    return
                }
                response.write(next.value)
            }
        }

        if (request.method === 'POST' && url.pathname === '/events/file-changed') {
            const payload = parseFileChangedPayload(config, await getRequestBody(request))
            publishRoomFileChanged(payload)
            sendJson(response, 200, { ok: true })
            return
        }

        if (request.method === 'POST' && url.pathname === '/files/materialize') {
            const file = materializeFileRequestBody(config, await getRequestBody(request))
            await writeVisibleFileNoFollow({
                root: file.root,
                path: file.path,
                content: file.content,
                mode: file.mode,
            })
            sendJson(response, 200, {
                ok: true,
                surface: file.surface,
                relativePath: file.relativePath,
                byteLength: file.content.byteLength,
            })
            return
        }

        if (request.method === 'POST' && url.pathname === '/files/read') {
            const file = readVisibleFileRequestBody(config, await getRequestBody(request))
            const read = await readVisibleFileNoFollow({
                root: file.root,
                path: file.path,
            })
            sendJson(response, 200, {
                ok: true,
                surface: file.surface,
                relativePath: file.relativePath,
                contentBase64: read.content.toString('base64url'),
                byteLength: read.byteLength,
            })
            return
        }

        if (request.method === 'POST' && url.pathname === '/files/delete') {
            const file = readVisibleFileRequestBody(config, await getRequestBody(request))
            await deleteVisibleFileNoFollow({
                root: file.root,
                path: file.path,
            })
            sendJson(response, 200, {
                ok: true,
                surface: file.surface,
                relativePath: file.relativePath,
            })
            return
        }

        throw new HttpError(404, `Pi runtime route ${url.pathname} was not found`)
    }
}
