import { AsyncLocalStorage } from 'node:async_hooks'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'

export type PerformancePrimitive = string | number | boolean | null
export type PerformanceAttributes = Record<string, PerformancePrimitive | undefined>

const traceStorage = new AsyncLocalStorage<{ traceId: string }>()
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const enabledValues = new Set(['1', 'true', 'yes', 'on'])

export function performanceLogsEnabled(): boolean {
    const value = process.env.AGENT_ROOM_PERF_LOGS ?? process.env.AGENT_ROOM_PERFORMANCE_LOGS ?? ''
    return enabledValues.has(value.trim().toLowerCase())
}

export function createPerformanceTraceId(): string {
    return randomUUID()
}

export function currentPerformanceTraceId(): string | null {
    return traceStorage.getStore()?.traceId ?? null
}

export function withPerformanceTrace<T>(traceId: string, operation: () => T): T {
    return traceStorage.run({ traceId }, operation)
}

export function performanceNow(): number {
    return performance.now()
}

export function elapsedPerformanceMs(startedAt: number): number {
    return Math.max(0, Math.round((performance.now() - startedAt) * 10) / 10)
}

function normalizeAttribute(value: PerformancePrimitive | undefined): PerformancePrimitive | null {
    if (value === undefined) {
        return null
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null
    }
    if (typeof value === 'string') {
        return value.length > 500 ? `${value.slice(0, 500)}...` : value
    }
    return value
}

export function logPerformanceEvent(name: string, attributes: PerformanceAttributes = {}): void {
    if (!performanceLogsEnabled()) {
        return
    }

    const traceId = currentPerformanceTraceId()
    const payload: Record<string, PerformancePrimitive> = {
        ts: new Date().toISOString(),
        level: 'info',
        event: 'agent_room.performance',
        name,
        traceId,
    }

    for (const [key, value] of Object.entries(attributes)) {
        payload[key] = normalizeAttribute(value)
    }

    console.log(JSON.stringify(payload))
}

export async function measurePerformance<T>(
    name: string,
    attributes: PerformanceAttributes,
    operation: () => Promise<T>,
): Promise<T> {
    const startedAt = performanceNow()
    try {
        const result = await operation()
        logPerformanceEvent(name, {
            ...attributes,
            status: 'ok',
            durationMs: elapsedPerformanceMs(startedAt),
        })
        return result
    } catch (error) {
        logPerformanceEvent(name, {
            ...attributes,
            status: 'error',
            durationMs: elapsedPerformanceMs(startedAt),
            errorName: error instanceof Error ? error.name : typeof error,
        })
        throw error
    }
}

function sanitizePathSegment(segment: string): string {
    if (!segment) {
        return segment
    }
    let decoded = segment
    try {
        decoded = decodeURIComponent(segment)
    } catch {}
    if (uuidPattern.test(decoded)) {
        return ':uuid'
    }
    if (/^\d+$/.test(decoded)) {
        return ':number'
    }
    if (decoded.length > 64) {
        return ':id'
    }
    return decoded
}

export function summarizeRoutePath(path: string): {
    routePath: string
    queryKeys: string | null
} {
    let pathname = path
    let queryKeys: string | null = null
    try {
        const url = new URL(path, 'http://agent-room.local')
        pathname = url.pathname
        const keys = [...new Set([...url.searchParams.keys()])].sort()
        queryKeys = keys.length > 0 ? keys.join(',') : null
    } catch {}

    const routePath =
        pathname
            .split('/')
            .map((segment) => sanitizePathSegment(segment))
            .join('/') || '/'

    return {
        routePath,
        queryKeys,
    }
}

export function byteLengthUtf8(value: string): number {
    return Buffer.byteLength(value, 'utf8')
}

export function jsonPayloadByteLength(value: unknown): number | null {
    try {
        return byteLengthUtf8(JSON.stringify(value))
    } catch {
        return null
    }
}

export function instrumentReadableByteStream(input: {
    stream: ReadableStream<Uint8Array>
    name: string
    attributes?: PerformanceAttributes
    abortSignal?: AbortSignal
}): ReadableStream<Uint8Array> {
    if (!performanceLogsEnabled()) {
        return input.stream
    }

    const startedAt = performanceNow()
    const attributes = input.attributes ?? {}
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
    let closed = false
    let firstChunkLogged = false
    let chunks = 0
    let bytes = 0
    let removeAbortListener: (() => void) | null = null

    const finish = (reason: string) => {
        if (closed) {
            return
        }
        closed = true
        removeAbortListener?.()
        logPerformanceEvent(`${input.name}.closed`, {
            ...attributes,
            reason,
            durationMs: elapsedPerformanceMs(startedAt),
            chunks,
            bytes,
        })
    }

    return new ReadableStream<Uint8Array>({
        start(controller) {
            reader = input.stream.getReader()
            const onAbort = () => {
                finish('aborted')
                void reader?.cancel()
                try {
                    controller.close()
                } catch {}
            }
            input.abortSignal?.addEventListener('abort', onAbort, { once: true })
            removeAbortListener = () => input.abortSignal?.removeEventListener('abort', onAbort)

            async function pump(): Promise<void> {
                try {
                    while (!closed) {
                        const result = await reader!.read()
                        if (result.done) {
                            finish('upstream_done')
                            try {
                                controller.close()
                            } catch {}
                            return
                        }
                        chunks += 1
                        bytes += result.value.byteLength
                        if (!firstChunkLogged) {
                            firstChunkLogged = true
                            logPerformanceEvent(`${input.name}.first_chunk`, {
                                ...attributes,
                                durationMs: elapsedPerformanceMs(startedAt),
                                chunkBytes: result.value.byteLength,
                            })
                        }
                        controller.enqueue(result.value)
                    }
                } catch (error) {
                    if (!closed) {
                        logPerformanceEvent(`${input.name}.error`, {
                            ...attributes,
                            durationMs: elapsedPerformanceMs(startedAt),
                            chunks,
                            bytes,
                            errorName: error instanceof Error ? error.name : typeof error,
                        })
                        closed = true
                        removeAbortListener?.()
                        controller.error(error)
                    }
                }
            }

            void pump()
        },
        cancel() {
            finish('consumer_cancelled')
            if (reader) {
                void reader.cancel()
                reader = null
            }
        },
    })
}
