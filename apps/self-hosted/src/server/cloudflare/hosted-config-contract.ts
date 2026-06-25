import { z } from 'zod'

export const hostedConfigValues = {
    authMode: 'better-auth',
    runtimeBackend: 'cloudflare-containers',
    runtimeStorage: 'r2',
} as const

export const hostedRequiredSecretNames = [
    'BETTER_AUTH_SECRET',
    'BETTER_AUTH_URL',
    'AGENT_ROOM_HOSTED_ENCRYPTION_KEY_B64',
    'AGENT_ROOM_BILLING_PLANS',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_CREDIT_TOPUP_PRICE_ID',
    'AGENT_ROOM_EMAIL_WEBHOOK_URL',
    'AGENT_ROOM_EMAIL_WEBHOOK_BEARER_TOKEN',
    'AGENT_ROOM_EMAIL_FROM',
    'AGENT_ROOM_HOSTED_OPENROUTER_API_KEY',
    'AGENT_ROOM_HOSTED_BRAVE_API_KEY',
] as const

export const hostedOptionalSecretNames = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] as const

export const hostedSecretNames = [
    ...hostedRequiredSecretNames,
    ...hostedOptionalSecretNames,
] as const

export type HostedSecretName = (typeof hostedSecretNames)[number]

const optionalSecretSchema = z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined))

const hostedEncryptionKeySchema = z
    .string()
    .trim()
    .superRefine((value, context) => {
        let byteLength = 0
        try {
            byteLength = atob(value).length
        } catch {
            context.addIssue({
                code: 'custom',
                message: 'AGENT_ROOM_HOSTED_ENCRYPTION_KEY_B64 must be valid base64',
            })
            return
        }
        if (byteLength !== 32) {
            context.addIssue({
                code: 'custom',
                message: 'AGENT_ROOM_HOSTED_ENCRYPTION_KEY_B64 must decode to 32 bytes',
            })
        }
    })

const hostedBillingPlanSchema = z
    .object({
        key: z.string().trim().min(1),
        priceId: z.string().trim().min(1),
        monthlyCents: z.number().int().positive(),
        includedCents: z.number().int().min(0),
    })
    .superRefine((plan, context) => {
        if (plan.includedCents > plan.monthlyCents) {
            context.addIssue({
                code: 'custom',
                path: ['includedCents'],
                message: 'Plan included usage cannot exceed its monthly price',
            })
        }
    })

const hostedBillingPlansSchema = z
    .string()
    .transform((value, context): unknown => {
        try {
            return JSON.parse(value)
        } catch {
            context.addIssue({
                code: 'custom',
                message: 'AGENT_ROOM_BILLING_PLANS must be valid JSON',
            })
            return z.NEVER
        }
    })
    .pipe(z.array(hostedBillingPlanSchema).min(1, 'At least one billing plan is required'))
    .superRefine((plans, context) => {
        const keys = new Set<string>()
        for (const plan of plans) {
            if (keys.has(plan.key)) {
                context.addIssue({
                    code: 'custom',
                    message: `Duplicate billing plan key ${plan.key}`,
                })
            }
            keys.add(plan.key)
        }
    })

export const hostedConfigSchema = z
    .object({
        AGENT_ROOM_AUTH_MODE: z.literal(hostedConfigValues.authMode),
        AGENT_ROOM_BILLING_PLANS: hostedBillingPlansSchema,
        AGENT_ROOM_BILLING_USAGE_MARKUP_BPS: z.coerce.number().int().min(10000),
        AGENT_ROOM_BILLING_TAX_MODE: z.enum(['none', 'automatic']),
        AGENT_ROOM_BILLING_MAX_CONCURRENT_ROOMS: z.coerce.number().int().min(1),
        AGENT_ROOM_RUNTIME_BACKEND: z.literal(hostedConfigValues.runtimeBackend),
        AGENT_ROOM_RUNTIME_STORAGE: z.literal(hostedConfigValues.runtimeStorage),
        BETTER_AUTH_SECRET: z.string().trim().min(32),
        BETTER_AUTH_URL: z
            .string()
            .trim()
            .url({ protocol: /^https$/ }),
        AGENT_ROOM_HOSTED_ENCRYPTION_KEY_B64: hostedEncryptionKeySchema,
        GOOGLE_CLIENT_ID: optionalSecretSchema,
        GOOGLE_CLIENT_SECRET: optionalSecretSchema,
        STRIPE_SECRET_KEY: z.string().trim().min(1),
        STRIPE_WEBHOOK_SECRET: z.string().trim().min(1),
        STRIPE_CREDIT_TOPUP_PRICE_ID: z.string().trim().min(1),
        AGENT_ROOM_HOSTED_OPENROUTER_API_KEY: z.string().trim().min(1),
        AGENT_ROOM_HOSTED_BRAVE_API_KEY: z.string().trim().min(1),
        AGENT_ROOM_EMAIL_WEBHOOK_URL: z
            .string()
            .trim()
            .url({ protocol: /^https$/ }),
        AGENT_ROOM_EMAIL_WEBHOOK_BEARER_TOKEN: z.string().trim().min(16),
        AGENT_ROOM_EMAIL_FROM: z.string().trim().min(1),
    })
    .superRefine((data, context) => {
        if (Boolean(data.GOOGLE_CLIENT_ID) !== Boolean(data.GOOGLE_CLIENT_SECRET)) {
            const missingSecret = data.GOOGLE_CLIENT_ID
                ? 'GOOGLE_CLIENT_SECRET'
                : 'GOOGLE_CLIENT_ID'
            context.addIssue({
                code: 'custom',
                path: [missingSecret],
                message: `${missingSecret} is required when Google OAuth is enabled`,
            })
        }
    })
