import { z } from 'zod'

export const hostedConfigValues = {
    authMode: 'better-auth',
    runtimeBackend: 'cloudflare-containers',
    runtimeStorage: 'r2',
} as const

export const hostedSecretNames = [
    'BETTER_AUTH_SECRET',
    'BETTER_AUTH_URL',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'AGENT_ROOM_EMAIL_WEBHOOK_URL',
    'AGENT_ROOM_EMAIL_WEBHOOK_BEARER_TOKEN',
    'AGENT_ROOM_EMAIL_FROM',
] as const

export type HostedSecretName = (typeof hostedSecretNames)[number]

export const hostedConfigSchema = z.object({
    AGENT_ROOM_AUTH_MODE: z.literal(hostedConfigValues.authMode),
    AGENT_ROOM_RUNTIME_BACKEND: z.literal(hostedConfigValues.runtimeBackend),
    AGENT_ROOM_RUNTIME_STORAGE: z.literal(hostedConfigValues.runtimeStorage),
    BETTER_AUTH_SECRET: z.string().trim().min(32),
    BETTER_AUTH_URL: z.string().trim().url(),
    GOOGLE_CLIENT_ID: z.string().trim().min(1),
    GOOGLE_CLIENT_SECRET: z.string().trim().min(1),
    AGENT_ROOM_EMAIL_WEBHOOK_URL: z.string().trim().url(),
    AGENT_ROOM_EMAIL_WEBHOOK_BEARER_TOKEN: z.string().trim().min(16),
    AGENT_ROOM_EMAIL_FROM: z.string().trim().min(1),
})
