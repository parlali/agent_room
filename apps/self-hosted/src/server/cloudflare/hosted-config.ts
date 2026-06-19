import type { AgentRoomHostedEnv } from './bindings'
import { hostedConfigSchema } from './hosted-config-contract'

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
