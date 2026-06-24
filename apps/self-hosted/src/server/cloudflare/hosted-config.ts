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
    encryptionKeyB64: string
    publicOrigin: string
    google: {
        clientId: string
        clientSecret: string
    } | null
    managedProviders: {
        openRouterApiKey: string | null
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

    let stripe: HostedConfig['billing']['stripe'] = null
    if (data.AGENT_ROOM_BILLING_MODE === 'stripe') {
        const secretKey = data.STRIPE_SECRET_KEY
        const webhookSecret = data.STRIPE_WEBHOOK_SECRET
        const creditTopupPriceId = data.STRIPE_CREDIT_TOPUP_PRICE_ID
        if (!secretKey || !webhookSecret || !creditTopupPriceId) {
            throw new Error(
                'Stripe billing mode requires STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, and STRIPE_CREDIT_TOPUP_PRICE_ID',
            )
        }
        stripe = {
            secretKey,
            webhookSecret,
            creditTopupPriceId,
        }
    }

    return {
        authMode: data.AGENT_ROOM_AUTH_MODE,
        billing: {
            mode: data.AGENT_ROOM_BILLING_MODE,
            plans: data.AGENT_ROOM_BILLING_PLANS,
            usageMarkupBps: data.AGENT_ROOM_BILLING_USAGE_MARKUP_BPS,
            taxMode: data.AGENT_ROOM_BILLING_TAX_MODE,
            maxConcurrentRoomsPerWorkspace: data.AGENT_ROOM_BILLING_MAX_CONCURRENT_ROOMS,
            stripe,
        },
        runtimeBackend: data.AGENT_ROOM_RUNTIME_BACKEND,
        runtimeStorage: data.AGENT_ROOM_RUNTIME_STORAGE,
        betterAuthSecret: data.BETTER_AUTH_SECRET,
        betterAuthUrl: data.BETTER_AUTH_URL.replace(/\/$/, ''),
        encryptionKeyB64: data.AGENT_ROOM_HOSTED_ENCRYPTION_KEY_B64,
        publicOrigin,
        google:
            data.GOOGLE_CLIENT_ID && data.GOOGLE_CLIENT_SECRET
                ? {
                      clientId: data.GOOGLE_CLIENT_ID,
                      clientSecret: data.GOOGLE_CLIENT_SECRET,
                  }
                : null,
        managedProviders: {
            openRouterApiKey: data.AGENT_ROOM_HOSTED_OPENROUTER_API_KEY ?? null,
        },
        emailWebhook: {
            url: data.AGENT_ROOM_EMAIL_WEBHOOK_URL,
            bearerToken: data.AGENT_ROOM_EMAIL_WEBHOOK_BEARER_TOKEN,
            from: data.AGENT_ROOM_EMAIL_FROM,
        },
    }
}
