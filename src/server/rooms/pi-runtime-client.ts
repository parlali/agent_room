import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import type { RoomFileChangedPayload } from './execution-types'
import { roomRuntimeMetadataRepository } from '../db/repositories'
import { getRoomPaths } from './room-paths'
import {
    byteLengthUtf8,
    elapsedPerformanceMs,
    logPerformanceEvent,
    performanceNow,
    summarizeRoutePath,
} from '../telemetry/performance'

export interface PiRuntimeRequestOptions {
    method?: 'GET' | 'POST' | 'DELETE'
    body?: unknown
    signal?: AbortSignal
}

async function getRuntimeEndpoint(roomId: string): Promise<{
    port: number
    token: string
}> {
    const metadata = await roomRuntimeMetadataRepository.findByRoomId(roomId)
    if (!metadata || metadata.port === null || metadata.pid === null) {
        throw new Error(`Room ${roomId} has no active Pi runtime endpoint`)
    }

    const paths = getRoomPaths(roomId)
    const token = (await readFile(paths.runtimeTokenPath, 'utf8')).trim()
    if (token.length < 24) {
        throw new Error(`Room ${roomId} runtime token is missing or invalid`)
    }

    return {
        port: metadata.port,
        token,
    }
}

export async function requestPiRuntime<T>(
    roomId: string,
    path: string,
    schema: z.ZodType<T>,
    options: PiRuntimeRequestOptions = {},
): Promise<T> {
    const route = summarizeRoutePath(path)
    const startedAt = performanceNow()
    let endpointLookupMs: number | null = null
    let fetchMs: number | null = null
    let parseMs: number | null = null
    let validationMs: number | null = null
    let statusCode: number | null = null
    let responseBytes: number | null = null
    const method = options.method ?? (options.body === undefined ? 'GET' : 'POST')
    const requestBody = options.body === undefined ? undefined : JSON.stringify(options.body)
    const requestBodyBytes = requestBody ? byteLengthUtf8(requestBody) : 0

    try {
        const endpointStartedAt = performanceNow()
        const endpoint = await getRuntimeEndpoint(roomId)
        endpointLookupMs = elapsedPerformanceMs(endpointStartedAt)

        const fetchStartedAt = performanceNow()
        const response = await fetch(`http://127.0.0.1:${endpoint.port}${path}`, {
            method,
            signal: options.signal,
            headers: {
                authorization: `Bearer ${endpoint.token}`,
                ...(requestBody === undefined ? {} : { 'content-type': 'application/json' }),
            },
            body: requestBody,
        })
        const text = await response.text()
        fetchMs = elapsedPerformanceMs(fetchStartedAt)
        statusCode = response.status
        responseBytes = byteLengthUtf8(text)

        const parseStartedAt = performanceNow()
        let parsed: unknown = null
        if (text.trim()) {
            parsed = JSON.parse(text)
        }
        parseMs = elapsedPerformanceMs(parseStartedAt)

        if (!response.ok) {
            const message =
                parsed && typeof parsed === 'object' && 'message' in parsed
                    ? String((parsed as { message: unknown }).message)
                    : `Pi runtime request failed with status ${response.status}`
            throw new Error(message)
        }

        const validationStartedAt = performanceNow()
        const result = schema.parse(parsed)
        validationMs = elapsedPerformanceMs(validationStartedAt)
        logPerformanceEvent('runtime_proxy.request', {
            roomId,
            method,
            routePath: route.routePath,
            queryKeys: route.queryKeys,
            status: 'ok',
            statusCode,
            durationMs: elapsedPerformanceMs(startedAt),
            endpointLookupMs,
            fetchMs,
            parseMs,
            validationMs,
            requestBodyBytes,
            responseBytes,
        })
        return result
    } catch (error) {
        logPerformanceEvent('runtime_proxy.request', {
            roomId,
            method,
            routePath: route.routePath,
            queryKeys: route.queryKeys,
            status: 'error',
            statusCode,
            durationMs: elapsedPerformanceMs(startedAt),
            endpointLookupMs,
            fetchMs,
            parseMs,
            validationMs,
            requestBodyBytes,
            responseBytes,
            errorName: error instanceof Error ? error.name : typeof error,
        })
        throw error
    }
}

async function openPiRuntimeStream(input: {
    roomId: string
    path: string
    signal?: AbortSignal
    streamKind: 'session' | 'room'
}): Promise<ReadableStream<Uint8Array>> {
    const route = summarizeRoutePath(input.path)
    const startedAt = performanceNow()
    let endpointLookupMs: number | null = null
    let statusCode: number | null = null
    try {
        const endpointStartedAt = performanceNow()
        const endpoint = await getRuntimeEndpoint(input.roomId)
        endpointLookupMs = elapsedPerformanceMs(endpointStartedAt)
        const response = await fetch(`http://127.0.0.1:${endpoint.port}${input.path}`, {
            method: 'GET',
            signal: input.signal,
            headers: {
                authorization: `Bearer ${endpoint.token}`,
                accept: 'text/event-stream',
            },
        })
        statusCode = response.status
        if (!response.ok || !response.body) {
            throw new Error(`Pi runtime event stream failed with status ${response.status}`)
        }

        logPerformanceEvent('runtime_proxy.stream_open', {
            roomId: input.roomId,
            streamKind: input.streamKind,
            routePath: route.routePath,
            queryKeys: route.queryKeys,
            status: 'ok',
            statusCode,
            durationMs: elapsedPerformanceMs(startedAt),
            endpointLookupMs,
        })
        return response.body
    } catch (error) {
        logPerformanceEvent('runtime_proxy.stream_open', {
            roomId: input.roomId,
            streamKind: input.streamKind,
            routePath: route.routePath,
            queryKeys: route.queryKeys,
            status: 'error',
            statusCode,
            durationMs: elapsedPerformanceMs(startedAt),
            endpointLookupMs,
            errorName: error instanceof Error ? error.name : typeof error,
        })
        throw error
    }
}

export async function openPiRuntimeEventStream(input: {
    roomId: string
    sessionKey: string
    signal?: AbortSignal
}): Promise<ReadableStream<Uint8Array>> {
    return openPiRuntimeStream({
        roomId: input.roomId,
        path: `/threads/${encodeURIComponent(input.sessionKey)}/events`,
        signal: input.signal,
        streamKind: 'session',
    })
}

export async function openPiRuntimeRoomEventStream(input: {
    roomId: string
    signal?: AbortSignal
}): Promise<ReadableStream<Uint8Array>> {
    return openPiRuntimeStream({
        roomId: input.roomId,
        path: '/events',
        signal: input.signal,
        streamKind: 'room',
    })
}

const publishFileChangedSchema = z.object({
    ok: z.literal(true),
})

export async function publishPiRuntimeRoomFileChanged(
    input: RoomFileChangedPayload,
): Promise<void> {
    await requestPiRuntime(input.roomId, '/events/file-changed', publishFileChangedSchema, {
        method: 'POST',
        body: input,
    })
}
