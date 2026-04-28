import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { z } from 'zod'

const rawEnvSchema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z
        .string()
        .min(1)
        .default('postgres://agent_room:agent_room@127.0.0.1:5432/agent_room?sslmode=disable'),
    AGENT_ROOM_DATA_DIR: z.string().min(1).default('.agent-room'),
    AGENT_ROOM_ENCRYPTION_KEY_B64: z.string().min(1).optional(),
    AGENT_ROOM_ROOT_EMAIL: z.email().optional(),
    AGENT_ROOM_ROOT_PASSWORD: z.string().min(12).optional(),
    AGENT_ROOM_SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24),
})

const generatedBootstrapSchema = z.object({
    encryptionKeyB64: z.string().min(1),
    rootEmail: z.email(),
    rootPassword: z.string().min(12),
    sessionTtlHours: z.number().int().positive(),
    generatedAt: z.string().min(1),
    updatedAt: z.string().min(1),
})

type GeneratedBootstrap = z.infer<typeof generatedBootstrapSchema>

export interface AppEnv {
    nodeEnv: 'development' | 'test' | 'production'
    port: number
    databaseUrl: string
    dataDir: string
    encryptionKey: Buffer
    rootEmail: string
    rootPassword: string
    sessionTtlHours: number
}

let cachedEnv: AppEnv | null = null

function parseEncryptionKey(base64: string): Buffer {
    const key = Buffer.from(base64, 'base64')
    if (key.length !== 32) {
        throw new Error('AGENT_ROOM_ENCRYPTION_KEY_B64 must decode to 32 bytes')
    }
    return key
}

function readGeneratedBootstrap(path: string): GeneratedBootstrap | null {
    if (!existsSync(path)) {
        return null
    }

    try {
        const raw = readFileSync(path, 'utf8')
        const parsed = JSON.parse(raw)
        const result = generatedBootstrapSchema.safeParse(parsed)
        if (!result.success) {
            return null
        }
        return result.data
    } catch {
        return null
    }
}

function writeGeneratedBootstrap(path: string, payload: GeneratedBootstrap) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(payload, null, 4)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
    })
}

function resolveBootstrapPayload(input: {
    dataDir: string
    providedEncryptionKeyB64?: string
    providedRootEmail?: string
    providedRootPassword?: string
    providedSessionTtlHours: number
}): {
    payload: GeneratedBootstrap
    generatedNewPayload: boolean
    generatedNewPassword: boolean
    generatedNewEncryptionKey: boolean
} {
    const bootstrapPath = resolve(input.dataDir, 'system', 'bootstrap.json')
    const existing = readGeneratedBootstrap(bootstrapPath)
    const now = new Date().toISOString()

    const generatedEncryptionKey = randomBytes(32).toString('base64')
    const generatedRootPassword = randomBytes(24).toString('base64url')

    const encryptionKeyB64 =
        input.providedEncryptionKeyB64 ?? existing?.encryptionKeyB64 ?? generatedEncryptionKey
    const rootEmail = input.providedRootEmail ?? existing?.rootEmail ?? 'root@agent-room.local'
    const rootPassword =
        input.providedRootPassword ?? existing?.rootPassword ?? generatedRootPassword
    const sessionTtlHours = input.providedSessionTtlHours

    const payload: GeneratedBootstrap = {
        encryptionKeyB64,
        rootEmail,
        rootPassword,
        sessionTtlHours,
        generatedAt: existing?.generatedAt ?? now,
        updatedAt: now,
    }

    const shouldWrite =
        !existing ||
        existing.encryptionKeyB64 !== payload.encryptionKeyB64 ||
        existing.rootEmail !== payload.rootEmail ||
        existing.rootPassword !== payload.rootPassword ||
        existing.sessionTtlHours !== payload.sessionTtlHours

    if (shouldWrite) {
        writeGeneratedBootstrap(bootstrapPath, payload)
    }

    return {
        payload,
        generatedNewPayload: !existing,
        generatedNewPassword: !existing && !input.providedRootPassword,
        generatedNewEncryptionKey: !existing && !input.providedEncryptionKeyB64,
    }
}

export function getAppEnv(): AppEnv {
    if (cachedEnv) {
        return cachedEnv
    }

    const parsed = rawEnvSchema.safeParse(process.env)
    if (!parsed.success) {
        throw new Error(`Invalid environment: ${parsed.error.message}`)
    }

    const data = parsed.data
    const dataDir = resolve(data.AGENT_ROOM_DATA_DIR)
    mkdirSync(dataDir, { recursive: true })

    const bootstrap = resolveBootstrapPayload({
        dataDir,
        providedEncryptionKeyB64: data.AGENT_ROOM_ENCRYPTION_KEY_B64,
        providedRootEmail: data.AGENT_ROOM_ROOT_EMAIL,
        providedRootPassword: data.AGENT_ROOM_ROOT_PASSWORD,
        providedSessionTtlHours: data.AGENT_ROOM_SESSION_TTL_HOURS,
    })

    const encryptionKey = parseEncryptionKey(bootstrap.payload.encryptionKeyB64)

    if (bootstrap.generatedNewPayload && data.NODE_ENV !== 'test') {
        console.log(
            `Agent Room bootstrap generated at ${resolve(dataDir, 'system', 'bootstrap.json')}`,
        )
        if (bootstrap.generatedNewEncryptionKey) {
            console.log('Generated encryption key for this deployment')
        }
        if (bootstrap.generatedNewPassword) {
            console.log(`Generated root login: ${bootstrap.payload.rootEmail}`)
            console.log(`Generated root password: ${bootstrap.payload.rootPassword}`)
        }
    }

    cachedEnv = {
        nodeEnv: data.NODE_ENV,
        port: data.PORT,
        databaseUrl: data.DATABASE_URL,
        dataDir,
        encryptionKey,
        rootEmail: bootstrap.payload.rootEmail,
        rootPassword: bootstrap.payload.rootPassword,
        sessionTtlHours: bootstrap.payload.sessionTtlHours,
    }

    return cachedEnv
}

export const __testing = {
    readGeneratedBootstrap,
    resolveBootstrapPayload,
}
