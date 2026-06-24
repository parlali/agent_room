import type { z } from 'zod'
import type { AgentRoomHostedEnv } from './bindings'
import { readHostedRuntimeArtifactText } from './hosted-runtime-artifacts'
import { getHostedRuntimeEndpointState } from './hosted-room-service'

export interface HostedPiRuntimeRequestOptions {
    method?: 'GET' | 'POST' | 'DELETE'
    body?: unknown
    signal?: AbortSignal
}

export async function readHostedRuntimeToken(input: {
    env: AgentRoomHostedEnv
    tokenObjectKey: string
}): Promise<string> {
    const token = (
        await readHostedRuntimeArtifactText({
            env: input.env,
            key: input.tokenObjectKey,
        })
    ).trim()
    if (token.length < 24) {
        throw new Error('Hosted runtime token is missing or invalid')
    }
    return token
}

async function runtimeEndpoint(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
}): Promise<{
    container: ReturnType<AgentRoomHostedEnv['AGENT_ROOM_RUNTIME']['getByName']>
    token: string
}> {
    const endpoint = await getHostedRuntimeEndpointState(input)
    if (!endpoint || endpoint.desiredState !== 'running' || endpoint.status === 'stopped') {
        throw new Error('Hosted runtime is not running')
    }
    if (!endpoint.runtime.tokenObjectKey) {
        throw new Error('Hosted runtime token is not active')
    }
    if (endpoint.runtime.healthStatus !== 'healthy') {
        throw new Error('Hosted runtime is not healthy')
    }
    const container = input.env.AGENT_ROOM_RUNTIME.getByName(endpoint.runtime.containerName)
    const state = await container.getState()
    if (state.status !== 'healthy') {
        throw new Error('Hosted runtime container is not healthy')
    }
    return {
        container,
        token: await readHostedRuntimeToken({
            env: input.env,
            tokenObjectKey: endpoint.runtime.tokenObjectKey,
        }),
    }
}

export async function requestHostedPiRuntime<T>(
    input: {
        env: AgentRoomHostedEnv
        workspaceId: string
        roomId: string
        path: string
        schema: z.ZodType<T>
    } & HostedPiRuntimeRequestOptions,
): Promise<T> {
    const endpoint = await runtimeEndpoint(input)
    const method = input.method ?? (input.body === undefined ? 'GET' : 'POST')
    const requestBody = input.body === undefined ? undefined : JSON.stringify(input.body)
    const response = await endpoint.container.fetch(
        new Request(`http://agent-room-runtime${input.path}`, {
            method,
            signal: input.signal,
            headers: {
                authorization: `Bearer ${endpoint.token}`,
                ...(requestBody === undefined ? {} : { 'content-type': 'application/json' }),
            },
            body: requestBody,
        }),
    )
    const text = await response.text()
    let parsed: unknown = null
    let parseError = false
    if (text.trim()) {
        try {
            parsed = JSON.parse(text)
        } catch {
            parseError = true
        }
    }
    if (!response.ok) {
        const snippet = text.slice(0, 120).replace(/\s+/g, ' ').trim()
        const detail = snippet ? ` — ${snippet}` : ''
        const message =
            !parseError && parsed && typeof parsed === 'object' && 'message' in parsed
                ? String((parsed as { message: unknown }).message)
                : `Hosted Pi runtime request failed with status ${response.status}${detail}`
        throw new Error(message)
    }
    if (parseError) {
        const snippet = text.slice(0, 120).replace(/\s+/g, ' ').trim()
        throw new Error(
            `Hosted Pi runtime returned non-JSON response (status ${response.status}): ${snippet}`,
        )
    }
    return input.schema.parse(parsed)
}

export async function openHostedPiRuntimeStream(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    roomId: string
    path: string
    signal?: AbortSignal
}): Promise<ReadableStream<Uint8Array>> {
    const endpoint = await runtimeEndpoint(input)
    const response = await endpoint.container.fetch(
        new Request(`http://agent-room-runtime${input.path}`, {
            method: 'GET',
            signal: input.signal,
            headers: {
                authorization: `Bearer ${endpoint.token}`,
                accept: 'text/event-stream',
            },
        }),
    )
    if (!response.ok || !response.body) {
        throw new Error(`Hosted Pi runtime event stream failed with status ${response.status}`)
    }
    return response.body
}
