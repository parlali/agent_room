import type { AgentRoomHostedEnv } from './bindings'
import type { HostedBillingPlan } from './hosted-billing-types'
import { hostedConfigSchema } from './hosted-config-contract'

export interface HostedEmailWebhookConfig {
    url: string
    bearerToken: string
    from: string
}

export interface HostedConfig {
    authMode: 'better-auth'
    billing: {
        mode: 'disabled' | 'stripe'
        plans: HostedBillingPlan[]
        usageMarkupBps: number
        taxMode: 'none' | 'automatic'
        maxConcurrentRoomsPerWorkspace: number
        stripe: {
            secretKey: string
            webhookSecret: string
            creditTopupPriceId: string
        } | null
    }
    runtimeBackend: 'cloudflare-containers'
    runtimeStorage: 'r2'
    betterAuthSecret: string
    betterAuthUrl: string
    publicOrigin: string
    google: {
        clientId: string
        clientSecret: string
    } | null
    emailWebhook: HostedEmailWebhookConfig
    hostedProviders: {
        openrouter: {
            apiKey: string
        } | null
        brave: {
            apiKey: string
        } | null
    }
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
        billing: {
            mode: data.AGENT_ROOM_BILLING_MODE,
            plans: data.AGENT_ROOM_BILLING_PLANS,
            usageMarkupBps: data.AGENT_ROOM_BILLING_USAGE_MARKUP_BPS,
            taxMode: data.AGENT_ROOM_BILLING_TAX_MODE,
            maxConcurrentRoomsPerWorkspace: data.AGENT_ROOM_BILLING_MAX_CONCURRENT_ROOMS,
            stripe:
                data.AGENT_ROOM_BILLING_MODE === 'stripe'
                    ? {
                          secretKey: data.STRIPE_SECRET_KEY ?? '',
                          webhookSecret: data.STRIPE_WEBHOOK_SECRET ?? '',
                          creditTopupPriceId: data.STRIPE_CREDIT_TOPUP_PRICE_ID ?? '',
                      }
                    : null,
        },
        runtimeBackend: data.AGENT_ROOM_RUNTIME_BACKEND,
        runtimeStorage: data.AGENT_ROOM_RUNTIME_STORAGE,
        betterAuthSecret: data.BETTER_AUTH_SECRET,
        betterAuthUrl: data.BETTER_AUTH_URL.replace(/\/$/, ''),
        publicOrigin,
        google:
            data.GOOGLE_CLIENT_ID && data.GOOGLE_CLIENT_SECRET
                ? {
                      clientId: data.GOOGLE_CLIENT_ID,
                      clientSecret: data.GOOGLE_CLIENT_SECRET,
                  }
                : null,
        emailWebhook: {
            url: data.AGENT_ROOM_EMAIL_WEBHOOK_URL,
            bearerToken: data.AGENT_ROOM_EMAIL_WEBHOOK_BEARER_TOKEN,
            from: data.AGENT_ROOM_EMAIL_FROM,
        },
        hostedProviders: {
            openrouter: data.AGENT_ROOM_HOSTED_OPENROUTER_API_KEY
                ? {
                      apiKey: data.AGENT_ROOM_HOSTED_OPENROUTER_API_KEY,
                  }
                : null,
            brave: data.AGENT_ROOM_HOSTED_BRAVE_API_KEY
                ? {
                      apiKey: data.AGENT_ROOM_HOSTED_BRAVE_API_KEY,
                  }
                : null,
        },
    }
}
