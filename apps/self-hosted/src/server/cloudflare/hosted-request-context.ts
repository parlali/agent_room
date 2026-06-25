import { AsyncLocalStorage } from 'node:async_hooks'
import type { AgentRoomHostedEnv } from './bindings'
import type { HostedActor } from './hosted-auth'

export interface HostedRequestContext {
    env: AgentRoomHostedEnv
    request: Request
    actor?: HostedActor | null
}

const hostedRequestStorage = new AsyncLocalStorage<HostedRequestContext>()

export function runWithHostedRequestContext<T>(context: HostedRequestContext, handler: () => T): T {
    return hostedRequestStorage.run(context, handler)
}

export function readHostedRequestContext(): HostedRequestContext | null {
    return hostedRequestStorage.getStore() ?? null
}

export function requireHostedRequestContext(): HostedRequestContext {
    const context = readHostedRequestContext()
    if (!context) {
        throw new Error('Hosted request context is not available')
    }
    return context
}
