import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { z } from 'zod'
import type { RuntimeSandboxHardening } from '#/domain/domain-types'
import { resolveRuntimeSandboxHardening } from '../rooms/runtime-sandbox-hardening'

const optionalRuntimeLimit = z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.coerce.number().int().nonnegative().optional(),
)

const rawEnvSchema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    AGENT_ROOM_AUTH_MODE: z.enum(['local', 'better-auth']).default('local'),
    DATABASE_URL: z
        .string()
        .min(1)
        .default('postgres://agent_room:agent_room@127.0.0.1:5432/agent_room?sslmode=disable'),
    AGENT_ROOM_DATA_DIR: z.string().min(1).default('.agent-room'),
    AGENT_ROOM_ENCRYPTION_KEY_B64: z.string().min(1).optional(),
    AGENT_ROOM_ROOT_EMAIL: z.email().optional(),
    AGENT_ROOM_ROOT_PASSWORD: z.string().min(12).optional(),
    AGENT_ROOM_SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24),
    AGENT_ROOM_PUBLIC_ORIGIN: z.string().url().optional(),
    AGENT_ROOM_SEARCH_ENABLED: z
        .string()
        .default('true')
        .transform((value) => value !== '0' && value.toLowerCase() !== 'false'),
    AGENT_ROOM_SEARCH_BACKEND_URL: z.string().url().default('http://searxng:8080'),
    AGENT_ROOM_SEARCH_DEFAULT_RESULTS: z.coerce.number().int().positive().max(20).default(5),
    AGENT_ROOM_SEARCH_TIMEOUT_MS: z.coerce.number().int().positive().max(30000).default(10000),
    AGENT_ROOM_SEARCH_MAX_PER_RUN: z.coerce.number().int().positive().max(100).default(20),
    AGENT_ROOM_RUN_BUDGET_MANUAL_MS: z.coerce
        .number()
        .int()
        .positive()
        .default(8 * 60 * 60 * 1000),
    AGENT_ROOM_RUN_BUDGET_SCHEDULED_MS: z.coerce
        .number()
        .int()
        .positive()
        .default(8 * 60 * 60 * 1000),
    AGENT_ROOM_RUN_BUDGET_DEEP_WORK_MS: z.coerce
        .number()
        .int()
        .positive()
        .default(6 * 60 * 60 * 1000),
    AGENT_ROOM_RUN_BUDGET_SUBAGENT_MS: z.coerce
        .number()
        .int()
        .positive()
        .default(2 * 60 * 60 * 1000),
    AGENT_ROOM_RUN_BUDGET_MAINTENANCE_MS: z.coerce
        .number()
        .int()
        .positive()
        .default(10 * 60 * 1000),
    AGENT_ROOM_IDLE_TIMEOUT_MS: z.coerce
        .number()
        .int()
        .positive()
        .default(10 * 60 * 1000),
    AGENT_ROOM_PROVIDER_IDLE_TIMEOUT_MS: z.coerce
        .number()
        .int()
        .positive()
        .default(2 * 60 * 1000),
    AGENT_ROOM_SHELL_COMMAND_TIMEOUT_MS: z.coerce
        .number()
        .int()
        .positive()
        .default(30 * 60 * 1000),
    AGENT_ROOM_WEB_FETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
    AGENT_ROOM_DOCUMENT_WORKER_TIMEOUT_MS: z.coerce
        .number()
        .int()
        .positive()
        .default(10 * 60 * 1000),
    AGENT_ROOM_IMAGE_GENERATION_TIMEOUT_MS: z.coerce
        .number()
        .int()
        .positive()
        .default(5 * 60 * 1000),
    AGENT_ROOM_MCP_TOOL_TIMEOUT_MS: z.coerce
        .number()
        .int()
        .positive()
        .default(2 * 60 * 1000),
    AGENT_ROOM_SHORT_COMMAND_WAIT_MS: z.coerce.number().int().positive().default(5000),
    AGENT_ROOM_BROWSER_ACTIONS_PER_TURN: z.coerce.number().int().positive().max(200).default(50),
    AGENT_ROOM_RUNTIME_MAX_PROCESSES: optionalRuntimeLimit,
    AGENT_ROOM_RUNTIME_MAX_OPEN_FILES: optionalRuntimeLimit,
    AGENT_ROOM_RUNTIME_MAX_FILE_SIZE_BYTES: optionalRuntimeLimit,
    AGENT_ROOM_RUNTIME_MAX_CPU_SECONDS: optionalRuntimeLimit,
    AGENT_ROOM_RUNTIME_MAX_ADDRESS_SPACE_BYTES: optionalRuntimeLimit,
    AGENT_ROOM_RUNTIME_RESTRICT_PRIVATE_NETWORK: z
        .string()
        .default('false')
        .transform((value) => value === '1' || value.toLowerCase() === 'true'),
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
    authMode: 'local' | 'better-auth'
    databaseUrl: string
    dataDir: string
    encryptionKey: Buffer
    rootEmail: string
    rootPassword: string
    sessionTtlHours: number
    publicOrigin: string | null
    search: {
        enabled: boolean
        backendUrl: string
        defaultResultCount: number
        timeoutMs: number
        maxSearchesPerRun: number
    }
    budgets: {
        manualTurnMs: number
        scheduledTurnMs: number
        deepWorkTurnMs: number
        subagentTurnMs: number
        maintenanceTurnMs: number
        idleTimeoutMs: number
        providerIdleTimeoutMs: number
        shellCommandMs: number
        webFetchMs: number
        documentWorkerMs: number
        imageGenerationMs: number
        mcpToolMs: number
        shortCommandWaitMs: number
        browserActionsPerTurn: number
    }
    sandbox: RuntimeSandboxHardening
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
        const bootstrapPath = resolve(dataDir, 'system', 'bootstrap.json')
        console.log(`Agent Room bootstrap generated at ${bootstrapPath}`)
        if (bootstrap.generatedNewEncryptionKey) {
            console.log('Generated encryption key for this deployment')
        }
        if (bootstrap.generatedNewPassword) {
            console.log(`Generated root login: ${bootstrap.payload.rootEmail}`)
            console.log(`Generated root password stored in ${bootstrapPath}`)
        }
    }

    cachedEnv = {
        nodeEnv: data.NODE_ENV,
        port: data.PORT,
        authMode: data.AGENT_ROOM_AUTH_MODE,
        databaseUrl: data.DATABASE_URL,
        dataDir,
        encryptionKey,
        rootEmail: bootstrap.payload.rootEmail,
        rootPassword: bootstrap.payload.rootPassword,
        sessionTtlHours: bootstrap.payload.sessionTtlHours,
        publicOrigin: data.AGENT_ROOM_PUBLIC_ORIGIN
            ? new URL(data.AGENT_ROOM_PUBLIC_ORIGIN).origin
            : null,
        search: {
            enabled: data.AGENT_ROOM_SEARCH_ENABLED,
            backendUrl: data.AGENT_ROOM_SEARCH_BACKEND_URL.replace(/\/$/, ''),
            defaultResultCount: data.AGENT_ROOM_SEARCH_DEFAULT_RESULTS,
            timeoutMs: data.AGENT_ROOM_SEARCH_TIMEOUT_MS,
            maxSearchesPerRun: data.AGENT_ROOM_SEARCH_MAX_PER_RUN,
        },
        budgets: {
            manualTurnMs: data.AGENT_ROOM_RUN_BUDGET_MANUAL_MS,
            scheduledTurnMs: data.AGENT_ROOM_RUN_BUDGET_SCHEDULED_MS,
            deepWorkTurnMs: data.AGENT_ROOM_RUN_BUDGET_DEEP_WORK_MS,
            subagentTurnMs: data.AGENT_ROOM_RUN_BUDGET_SUBAGENT_MS,
            maintenanceTurnMs: data.AGENT_ROOM_RUN_BUDGET_MAINTENANCE_MS,
            idleTimeoutMs: data.AGENT_ROOM_IDLE_TIMEOUT_MS,
            providerIdleTimeoutMs: data.AGENT_ROOM_PROVIDER_IDLE_TIMEOUT_MS,
            shellCommandMs: data.AGENT_ROOM_SHELL_COMMAND_TIMEOUT_MS,
            webFetchMs: data.AGENT_ROOM_WEB_FETCH_TIMEOUT_MS,
            documentWorkerMs: data.AGENT_ROOM_DOCUMENT_WORKER_TIMEOUT_MS,
            imageGenerationMs: data.AGENT_ROOM_IMAGE_GENERATION_TIMEOUT_MS,
            mcpToolMs: data.AGENT_ROOM_MCP_TOOL_TIMEOUT_MS,
            shortCommandWaitMs: data.AGENT_ROOM_SHORT_COMMAND_WAIT_MS,
            browserActionsPerTurn: data.AGENT_ROOM_BROWSER_ACTIONS_PER_TURN,
        },
        sandbox: resolveRuntimeSandboxHardening({
            cpuSeconds: data.AGENT_ROOM_RUNTIME_MAX_CPU_SECONDS,
            addressSpaceBytes: data.AGENT_ROOM_RUNTIME_MAX_ADDRESS_SPACE_BYTES,
            fileSizeBytes: data.AGENT_ROOM_RUNTIME_MAX_FILE_SIZE_BYTES,
            processCount: data.AGENT_ROOM_RUNTIME_MAX_PROCESSES,
            openFiles: data.AGENT_ROOM_RUNTIME_MAX_OPEN_FILES,
            restrictPrivateNetwork: data.AGENT_ROOM_RUNTIME_RESTRICT_PRIVATE_NETWORK,
        }),
    }

    return cachedEnv
}

export const __testing = {
    readGeneratedBootstrap,
    resolveBootstrapPayload,
}
