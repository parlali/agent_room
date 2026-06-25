import { AsyncLocalStorage } from 'node:async_hooks'
import { getRequest } from '@tanstack/react-start/server'
import type { AgentRoomHostedEnv } from './bindings'
import type { HostedActor } from './hosted-auth'

export interface HostedRequestContext {
    env: AgentRoomHostedEnv
    request: Request
    actor?: HostedActor | null
}

const hostedRequestStorage = new AsyncLocalStorage<HostedRequestContext>()
const hostedContextByRequest = new WeakMap<Request, HostedRequestContext>()

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
    return Boolean(value) && typeof (value as Promise<T>).then === 'function'
}

export function runWithHostedRequestContext<T>(context: HostedRequestContext, handler: () => T): T {
    hostedContextByRequest.set(context.request, context)
    const result = hostedRequestStorage.run(context, handler)
    if (isPromiseLike(result)) {
        return result.finally(() => {
            hostedContextByRequest.delete(context.request)
        }) as T
    }
    hostedContextByRequest.delete(context.request)
    return result
}

export function readHostedRequestContext(): HostedRequestContext | null {
    const stored = hostedRequestStorage.getStore()
    if (stored) {
        return stored
    }
    try {
        return hostedContextByRequest.get(getRequest()) ?? null
    } catch {
        return null
    }
}

export function requireHostedRequestContext(): HostedRequestContext {
    const context = readHostedRequestContext()
    if (!context) {
        throw new Error('Hosted request context is not available')
    }
    return context
}
