interface D1Database {
    prepare: (query: string) => D1PreparedStatement
    batch: <TValue = unknown>(statements: D1PreparedStatement[]) => Promise<D1Result<TValue>[]>
}

interface D1PreparedStatement {
    bind: (...values: unknown[]) => D1PreparedStatement
    first: <TValue = unknown>() => Promise<TValue | null>
    all: <TValue = unknown>() => Promise<D1Result<TValue>>
    run: <TValue = unknown>() => Promise<D1Result<TValue>>
}

interface D1Result<T = unknown> {
    results?: T[]
    success: boolean
    meta: Record<string, unknown>
}

interface R2Bucket {
    get: (key: string) => Promise<R2ObjectBody | null>
    put: (
        key: string,
        value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null,
    ) => Promise<R2Object>
    delete: (key: string) => Promise<void>
}

interface R2Object {
    key: string
}

interface R2ObjectBody extends R2Object {
    body: ReadableStream
}

interface Queue<TValue = unknown> {
    send: (message: TValue) => Promise<void>
}

interface MessageBatch<TValue = unknown> {
    messages: Array<{
        body: TValue
        ack: () => void
        retry: () => void
    }>
}

interface DurableObjectId {
    toString: () => string
}

interface DurableObjectStub<TValue = unknown> {
    fetch: (request: Request) => Promise<Response>
}

interface DurableObjectNamespace<TValue = unknown> {
    get: (id: DurableObjectId) => DurableObjectStub<TValue>
    getByName: (name: string) => DurableObjectStub<TValue>
    idFromName: (name: string) => DurableObjectId
}

interface DurableObjectState {
    storage: unknown
}

interface ExecutionContext {
    waitUntil: (promise: Promise<unknown>) => void
    passThroughOnException: () => void
}

interface ScheduledController {
    cron: string
    scheduledTime: number
}

interface ExportedHandler<TEnv = unknown> {
    fetch?: (request: Request, env: TEnv, ctx: ExecutionContext) => Response | Promise<Response>
    queue?: (batch: MessageBatch, env: TEnv, ctx: ExecutionContext) => void | Promise<void>
    scheduled?: (
        controller: ScheduledController,
        env: TEnv,
        ctx: ExecutionContext,
    ) => void | Promise<void>
}

declare namespace Cloudflare {
    interface Env {}
}

declare module 'cloudflare:workers' {
    export class DurableObject<TEnv = unknown> {
        ctx: DurableObjectState
        env: TEnv
        constructor(ctx: DurableObjectState, env: TEnv)
    }

    export class WorkerEntrypoint<TEnv = unknown, TProps = unknown> {
        env: TEnv
        ctx: ExecutionContext
        props: TProps
        fetch: (request: Request) => Response | Promise<Response>
    }
}
