import { readFile } from 'node:fs/promises'
import type { z } from 'zod'
import { roomRuntimeMetadataRepository } from '../db/repositories'
import { getRoomPaths } from './room-paths'

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
    const endpoint = await getRuntimeEndpoint(roomId)
    const response = await fetch(`http://127.0.0.1:${endpoint.port}${path}`, {
        method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
        signal: options.signal,
        headers: {
            authorization: `Bearer ${endpoint.token}`,
            ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })

    const text = await response.text()
    let parsed: unknown = null
    if (text.trim()) {
        parsed = JSON.parse(text)
    }

    if (!response.ok) {
        const message =
            parsed && typeof parsed === 'object' && 'message' in parsed
                ? String((parsed as { message: unknown }).message)
                : `Pi runtime request failed with status ${response.status}`
        throw new Error(message)
    }

    return schema.parse(parsed)
}

export async function openPiRuntimeEventStream(input: {
    roomId: string
    sessionKey: string
    signal?: AbortSignal
}): Promise<ReadableStream<Uint8Array>> {
    const endpoint = await getRuntimeEndpoint(input.roomId)
    const response = await fetch(
        `http://127.0.0.1:${endpoint.port}/threads/${encodeURIComponent(input.sessionKey)}/events`,
        {
            method: 'GET',
            signal: input.signal,
            headers: {
                authorization: `Bearer ${endpoint.token}`,
                accept: 'text/event-stream',
            },
        },
    )

    if (!response.ok || !response.body) {
        throw new Error(`Pi runtime event stream failed with status ${response.status}`)
    }

    return response.body
}
