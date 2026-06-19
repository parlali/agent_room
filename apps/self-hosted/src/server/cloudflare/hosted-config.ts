import { z } from 'zod'
import type { AgentRoomHostedEnv } from './bindings'

const hostedConfigSchema = z.object({
    AGENT_ROOM_AUTH_MODE: z.literal('better-auth'),
    AGENT_ROOM_RUNTIME_BACKEND: z.literal('cloudflare-containers'),
    AGENT_ROOM_RUNTIME_STORAGE: z.literal('r2'),
    BETTER_AUTH_SECRET: z.string().trim().min(32),
    BETTER_AUTH_URL: z.string().trim().url(),
    GOOGLE_CLIENT_ID: z.string().trim().min(1),
    GOOGLE_CLIENT_SECRET: z.string().trim().min(1),
    AGENT_ROOM_EMAIL_WEBHOOK_URL: z.string().trim().url(),
    AGENT_ROOM_EMAIL_WEBHOOK_BEARER_TOKEN: z.string().trim().min(16),
    AGENT_ROOM_EMAIL_FROM: z.string().trim().min(1),
})

export interface HostedEmailWebhookConfig {
    url: string
    bearerToken: string
    from: string
}

export interface HostedConfig {
    authMode: 'better-auth'
    runtimeBackend: 'cloudflare-containers'
    runtimeStorage: 'r2'
    betterAuthSecret: string
    betterAuthUrl: string
    publicOrigin: string
    google: {
        clientId: string
        clientSecret: string
    }
    emailWebhook: HostedEmailWebhookConfig
}

export function resolveHostedConfig(env: AgentRoomHostedEnv): HostedConfig {
    const parsed = hostedConfigSchema.safeParse(env)
    if (!parsed.success) {
        throw new Error(`Invalid hosted Cloudflare configuration: ${parsed.error.message}`)
    }

    const data = parsed.data
    const publicOrigin = new URL(data.BETTER_AUTH_URL).origin

    return {
        authMode: data.AGENT_ROOM_AUTH_MODE,
        runtimeBackend: data.AGENT_ROOM_RUNTIME_BACKEND,
        runtimeStorage: data.AGENT_ROOM_RUNTIME_STORAGE,
        betterAuthSecret: data.BETTER_AUTH_SECRET,
        betterAuthUrl: data.BETTER_AUTH_URL.replace(/\/$/, ''),
        publicOrigin,
        google: {
            clientId: data.GOOGLE_CLIENT_ID,
            clientSecret: data.GOOGLE_CLIENT_SECRET,
        },
        emailWebhook: {
            url: data.AGENT_ROOM_EMAIL_WEBHOOK_URL,
            bearerToken: data.AGENT_ROOM_EMAIL_WEBHOOK_BEARER_TOKEN,
            from: data.AGENT_ROOM_EMAIL_FROM,
        },
    }
}
