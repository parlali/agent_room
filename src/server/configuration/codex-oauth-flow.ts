import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:net'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
    appProviderConnectionRepository,
    appSettingsRepository,
    auditRepository,
    roomConfigRepository,
    roomRepository,
} from '../db/repositories'
import type {
    AppProviderConnectionRecord,
    MaterializedRoomConfiguration,
    ProviderApi,
} from '../domain/types'
import { buildOpenClawRuntimeConfig } from '../rooms/openclaw-config'
import { ensureRoomFilesystemLayout } from '../rooms/room-paths'
import { inspectCodexAuthStatus } from './codex-auth'
import { resolveProviderBaseUrl } from './provider-config'

export const codexOAuthSessionStatuses = [
    'idle',
    'starting',
    'awaiting_redirect',
    'submitting',
    'complete',
    'failed',
    'cancelled',
    'expired',
] as const

export type CodexOAuthSessionStatus = (typeof codexOAuthSessionStatuses)[number]

export interface CodexOAuthSessionSnapshot {
    roomId: string
    status: CodexOAuthSessionStatus
    authUrl: string | null
    profilePath: string
    message: string
    startedAt: string | null
    updatedAt: string | null
    completedAt: string | null
}

interface CodexOAuthTarget {
    roomId: string
    displayName: string
    provider: string
    api: ProviderApi
    baseUrl: string | null
    model: string
    fallbackModels: string[]
}

interface CodexOAuthSessionState {
    roomId: string
    actorUserId: string
    status: CodexOAuthSessionStatus
    authUrl: string | null
    profilePath: string
    message: string
    startedAt: Date
    updatedAt: Date
    completedAt: Date | null
    output: string
    authUrlPath: string | null
    callbackPortBlocker: Server | null
    child: ChildProcessWithoutNullStreams | null
    timeout: ReturnType<typeof setTimeout> | null
}

const sessions = new Map<string, CodexOAuthSessionState>()
const openAICodexAuthorizeUrlPattern = /https:\/\/auth\.openai\.com\/oauth\/authorize\?[^\s"'<>]+/
const codexOAuthTimeoutMs = 15 * 60 * 1000
const openClawOAuthExpectScript = [
    'log_user 1',
    'set timeout -1',
    'spawn -noecho openclaw models auth login --provider openai-codex --method oauth',
    'expect {',
    '    -re {https://auth\\.openai\\.com/oauth/authorize[^[:space:]<>]+} {',
    '        if {[info exists env(AGENT_ROOM_CODEX_OAUTH_URL_FILE)]} {',
    '            set url_file [open $env(AGENT_ROOM_CODEX_OAUTH_URL_FILE) w]',
    '            puts $url_file $expect_out(0,string)',
    '            close $url_file',
    '        }',
    '        puts "\\n$expect_out(0,string)\\n"',
    '        flush stdout',
    '    }',
    '    eof { exit 1 }',
    '}',
    'expect_user -re {(.+)\\r?\\n}',
    'send -- "$expect_out(1,string)\\r"',
    'set result [wait]',
    'exit [lindex $result 3]',
].join('\n')
const escapeCharacter = String.fromCharCode(27)
const bellCharacter = String.fromCharCode(7)
const oscAnsiPattern = new RegExp(
    `${escapeCharacter}\\][\\s\\S]*?(?:${bellCharacter}|${escapeCharacter}\\\\)`,
    'g',
)
const csiAnsiPattern = new RegExp(`${escapeCharacter}\\[[0-?]*[ -/]*[@-~]`, 'g')

function stripAnsi(value: string): string {
    return value.replace(oscAnsiPattern, '').replace(csiAnsiPattern, '')
}

function chunkToText(chunk: Buffer | Uint8Array | string): string {
    if (typeof chunk === 'string') {
        return chunk
    }
    return Buffer.from(chunk).toString('utf8')
}

export function extractOpenAICodexAuthUrl(output: string): string | null {
    const sanitized = stripAnsi(output)
    const match = sanitized.match(openAICodexAuthorizeUrlPattern)
    return match ? match[0] : null
}

function toStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return []
    }
    return value.filter((entry): entry is string => typeof entry === 'string')
}

function isCodexProvider(provider: AppProviderConnectionRecord): boolean {
    return provider.provider === 'openai-codex' || provider.api === 'openai-codex-responses'
}

function validateRedirectUrlValue(value: string): string {
    const trimmed = value.trim()
    if (!trimmed) {
        throw new Error('Paste the full redirect URL from the browser')
    }
    if (trimmed.length > 5000) {
        throw new Error('Redirect URL is too long')
    }

    try {
        const parsed = new URL(trimmed)
        const code = parsed.searchParams.get('code')
        const state = parsed.searchParams.get('state')
        if (!code || !state) {
            throw new Error('Redirect URL must include code and state parameters')
        }
        return trimmed
    } catch (error) {
        if (error instanceof Error && error.message.includes('code and state')) {
            throw error
        }
    }

    if (/^[A-Za-z0-9._~/-]+$/.test(trimmed)) {
        return trimmed
    }

    throw new Error('Paste the full redirect URL from the browser')
}

function toSnapshot(session: CodexOAuthSessionState): CodexOAuthSessionSnapshot {
    return {
        roomId: session.roomId,
        status: session.status,
        authUrl: session.authUrl,
        profilePath: session.profilePath,
        message: session.message,
        startedAt: session.startedAt.toISOString(),
        updatedAt: session.updatedAt.toISOString(),
        completedAt: session.completedAt?.toISOString() ?? null,
    }
}

function updateSession(
    session: CodexOAuthSessionState,
    patch: Partial<
        Pick<
            CodexOAuthSessionState,
            'status' | 'authUrl' | 'message' | 'completedAt' | 'child' | 'timeout'
        >
    >,
) {
    Object.assign(session, patch)
    session.updatedAt = new Date()
}

function sessionWasCancelled(session: CodexOAuthSessionState): boolean {
    return session.status === 'cancelled'
}

async function appendCodexAudit(input: {
    actorUserId: string
    roomId: string
    action: string
    status: CodexOAuthSessionStatus
    message: string
}) {
    await auditRepository.appendEvent({
        actorUserId: input.actorUserId,
        roomId: input.roomId,
        action: input.action,
        payload: {
            status: input.status,
            message: input.message,
        },
    })
}

async function waitForAuthUrl(session: CodexOAuthSessionState, timeoutMs: number) {
    const deadline = Date.now() + timeoutMs
    while (
        Date.now() < deadline &&
        session.status === 'starting' &&
        !session.authUrl &&
        session.child
    ) {
        await readAuthUrlFile(session)
        await delay(100)
    }
    await readAuthUrlFile(session)
}

async function readAuthUrlFile(session: CodexOAuthSessionState) {
    if (!session.authUrlPath || session.authUrl) {
        return
    }

    try {
        const output = await readFile(session.authUrlPath, 'utf8')
        const authUrl = extractOpenAICodexAuthUrl(output)
        if (authUrl) {
            updateSession(session, {
                status: 'awaiting_redirect',
                authUrl,
                message: 'OpenAI Codex OAuth URL is ready',
            })
            await rm(session.authUrlPath, {
                force: true,
            })
        }
    } catch (error) {
        if (
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            String((error as { code: unknown }).code) === 'ENOENT'
        ) {
            return
        }
        throw error
    }
}

async function removeAuthUrlFile(session: CodexOAuthSessionState) {
    if (!session.authUrlPath) {
        return
    }
    await rm(session.authUrlPath, {
        force: true,
    })
}

async function reserveCodexCallbackPort(): Promise<Server | null> {
    return new Promise((resolve) => {
        const server = createServer()
        server.once('error', () => resolve(null))
        server.listen(1455, '127.0.0.1', () => resolve(server))
    })
}

async function closeCallbackPortBlocker(session: CodexOAuthSessionState) {
    const server = session.callbackPortBlocker
    if (!server) {
        return
    }
    session.callbackPortBlocker = null
    await new Promise<void>((resolve) => {
        server.close(() => resolve())
    })
}

async function resolveCodexOAuthTarget(roomId: string): Promise<CodexOAuthTarget> {
    const room = await roomRepository.findRoomById(roomId)
    if (!room) {
        throw new Error(`Room ${roomId} does not exist`)
    }

    const [config, settings] = await Promise.all([
        roomConfigRepository.getOrCreate(roomId),
        appSettingsRepository.getOrCreate(),
    ])

    if (config.providerMode === 'room_secret') {
        throw new Error('OpenAI Codex OAuth must use an app-scoped provider connection')
    }

    const providerConnectionId =
        config.providerMode === 'app_connection'
            ? config.providerConnectionId
            : settings.defaultProviderConnectionId
    if (!providerConnectionId) {
        throw new Error('Room has no effective provider connection')
    }

    const provider = await appProviderConnectionRepository.findById(providerConnectionId)
    if (!provider) {
        throw new Error('Room effective provider connection was not found')
    }
    if (!isCodexProvider(provider)) {
        throw new Error('Room effective provider is not OpenAI Codex OAuth')
    }
    if (provider.authMode !== 'oauth') {
        throw new Error('OpenAI Codex provider must use OAuth auth mode')
    }
    if (provider.status !== 'ready') {
        throw new Error(provider.validationMessage ?? 'OpenAI Codex provider is not ready')
    }

    return {
        roomId,
        displayName: room.displayName,
        provider: provider.provider,
        api: provider.api,
        baseUrl: provider.baseUrl,
        model:
            config.providerMode === 'app_default'
                ? (settings.defaultModel ?? provider.defaultModel)
                : provider.defaultModel,
        fallbackModels: toStringArray(provider.fallbackModels),
    }
}

async function writeCodexAuthRuntimeConfig(target: CodexOAuthTarget): Promise<string> {
    const paths = await ensureRoomFilesystemLayout(target.roomId)
    const roomConfiguration: MaterializedRoomConfiguration = {
        instructions: '',
        toolsProfile: 'coding',
        provider: {
            provider: target.provider,
            authMode: 'oauth',
            api: target.api,
            model: target.model,
            fallbackModels: target.fallbackModels,
            baseUrl: resolveProviderBaseUrl({
                provider: target.provider,
                api: target.api,
                baseUrl: target.baseUrl,
            }),
            envKey: null,
        },
        entitlements: {
            env: {},
            secretRefs: [],
            mcpServers: [],
        },
    }
    const config = buildOpenClawRuntimeConfig({
        roomId: target.roomId,
        displayName: target.displayName,
        port: 1456,
        paths,
        roomConfiguration,
    })

    await writeFile(paths.runtimeConfigPath, JSON.stringify(config, null, 4), {
        encoding: 'utf8',
        mode: 0o600,
    })
    return paths.runtimeConfigPath
}

async function finalizeSession(session: CodexOAuthSessionState, exitCode: number | null) {
    if (session.timeout) {
        clearTimeout(session.timeout)
    }
    await removeAuthUrlFile(session)
    await closeCallbackPortBlocker(session)
    updateSession(session, {
        child: null,
        timeout: null,
        completedAt: new Date(),
    })

    if (session.status === 'expired') {
        await appendCodexAudit({
            actorUserId: session.actorUserId,
            roomId: session.roomId,
            action: 'codex_oauth.expired',
            status: session.status,
            message: session.message,
        })
        return
    }

    if (sessionWasCancelled(session)) {
        return
    }

    if (exitCode !== 0) {
        updateSession(session, {
            status: 'failed',
            authUrl: null,
            message: `OpenClaw OAuth process exited with code ${String(exitCode)}`,
        })
        await appendCodexAudit({
            actorUserId: session.actorUserId,
            roomId: session.roomId,
            action: 'codex_oauth.failed',
            status: session.status,
            message: session.message,
        })
        return
    }

    await delay(250)
    if (sessionWasCancelled(session)) {
        return
    }

    const authStatus = await inspectCodexAuthStatus(session.roomId)
    if (sessionWasCancelled(session)) {
        return
    }

    if (authStatus.ready) {
        updateSession(session, {
            status: 'complete',
            message: authStatus.message,
        })
        await appendCodexAudit({
            actorUserId: session.actorUserId,
            roomId: session.roomId,
            action: 'codex_oauth.completed',
            status: session.status,
            message: 'OpenAI Codex OAuth profile stored for room',
        })
        return
    }

    updateSession(session, {
        status: 'failed',
        authUrl: null,
        message: authStatus.message,
    })
    await appendCodexAudit({
        actorUserId: session.actorUserId,
        roomId: session.roomId,
        action: 'codex_oauth.failed',
        status: session.status,
        message: session.message,
    })
}

function attachOutputHandlers(session: CodexOAuthSessionState) {
    const child = session.child
    if (!child) {
        return
    }

    const onData = (chunk: Buffer | Uint8Array | string) => {
        session.output = `${session.output}${stripAnsi(chunkToText(chunk))}`.slice(-12000)
        const authUrl = extractOpenAICodexAuthUrl(session.output)
        if (authUrl && session.authUrl !== authUrl) {
            updateSession(session, {
                status: 'awaiting_redirect',
                authUrl,
                message: 'OpenAI Codex OAuth URL is ready',
            })
        }
    }

    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', (error) => {
        void removeAuthUrlFile(session)
        void closeCallbackPortBlocker(session)
        updateSession(session, {
            status: 'failed',
            authUrl: null,
            message: error.message,
            child: null,
            completedAt: new Date(),
        })
        if (session.timeout) {
            clearTimeout(session.timeout)
            session.timeout = null
        }
        void appendCodexAudit({
            actorUserId: session.actorUserId,
            roomId: session.roomId,
            action: 'codex_oauth.failed',
            status: session.status,
            message: session.message,
        })
    })
    child.on('exit', (exitCode) => {
        void finalizeSession(session, exitCode)
    })
}

export async function getCodexOAuthSessionSnapshot(
    roomId: string,
): Promise<CodexOAuthSessionSnapshot> {
    const existing = sessions.get(roomId)
    if (existing) {
        if (existing.status === 'starting' && !existing.authUrl) {
            await readAuthUrlFile(existing)
        }
        return toSnapshot(existing)
    }

    const authStatus = await inspectCodexAuthStatus(roomId)
    return {
        roomId,
        status: authStatus.ready ? 'complete' : 'idle',
        authUrl: null,
        profilePath: authStatus.profilePath,
        message: authStatus.message,
        startedAt: null,
        updatedAt: null,
        completedAt: null,
    }
}

export async function startCodexOAuthSession(
    roomId: string,
    actorUserId: string,
): Promise<CodexOAuthSessionSnapshot> {
    const current = sessions.get(roomId)
    if (
        current?.child &&
        ['starting', 'awaiting_redirect', 'submitting'].includes(current.status)
    ) {
        return toSnapshot(current)
    }

    if (current?.child) {
        current.child.kill('SIGTERM')
    }

    const target = await resolveCodexOAuthTarget(roomId)
    const runtimeConfigPath = await writeCodexAuthRuntimeConfig(target)
    const paths = await ensureRoomFilesystemLayout(roomId)
    const profilePath = (await inspectCodexAuthStatus(roomId)).profilePath
    const authUrlPath = join(paths.runtimeDir, 'codex-oauth-url.txt')
    await rm(authUrlPath, {
        force: true,
    })
    const callbackPortBlocker = await reserveCodexCallbackPort()
    const child = spawn('expect', ['-c', openClawOAuthExpectScript], {
        env: {
            ...process.env,
            NO_COLOR: '1',
            AGENT_ROOM_CODEX_OAUTH_URL_FILE: authUrlPath,
            OPENCLAW_CONFIG_PATH: runtimeConfigPath,
            OPENCLAW_STATE_DIR: paths.engineStateDir,
        },
        stdio: 'pipe',
    })
    const session: CodexOAuthSessionState = {
        roomId,
        actorUserId,
        status: 'starting',
        authUrl: null,
        profilePath,
        message: 'Starting OpenAI Codex OAuth with OpenClaw',
        startedAt: new Date(),
        updatedAt: new Date(),
        completedAt: null,
        output: '',
        authUrlPath,
        callbackPortBlocker,
        child,
        timeout: null,
    }
    session.timeout = setTimeout(() => {
        updateSession(session, {
            status: 'expired',
            authUrl: null,
            message: 'OpenAI Codex OAuth session expired before completion',
            completedAt: new Date(),
        })
        child.kill('SIGTERM')
    }, codexOAuthTimeoutMs)
    sessions.set(roomId, session)
    attachOutputHandlers(session)

    await appendCodexAudit({
        actorUserId,
        roomId,
        action: 'codex_oauth.started',
        status: session.status,
        message: 'Started OpenAI Codex OAuth process',
    })

    await waitForAuthUrl(session, 10_000)

    return toSnapshot(session)
}

export async function submitCodexOAuthRedirect(input: {
    roomId: string
    redirectUrl: string
    actorUserId: string
}): Promise<CodexOAuthSessionSnapshot> {
    const session = sessions.get(input.roomId)
    if (!session?.child) {
        throw new Error('No active OpenAI Codex OAuth session for this room')
    }
    if (session.actorUserId !== input.actorUserId) {
        throw new Error('OpenAI Codex OAuth session was started by another operator')
    }
    if (session.status !== 'awaiting_redirect') {
        throw new Error('OpenAI Codex OAuth session is not waiting for a redirect URL')
    }

    const redirectUrl = validateRedirectUrlValue(input.redirectUrl)
    updateSession(session, {
        status: 'submitting',
        message: 'Submitting redirect URL to OpenClaw',
    })
    session.child.stdin.write(`${redirectUrl}\n`)
    return toSnapshot(session)
}

export async function cancelCodexOAuthSession(input: {
    roomId: string
    actorUserId: string
}): Promise<CodexOAuthSessionSnapshot> {
    const session = sessions.get(input.roomId)
    if (!session) {
        return getCodexOAuthSessionSnapshot(input.roomId)
    }
    if (session.actorUserId !== input.actorUserId) {
        throw new Error('OpenAI Codex OAuth session was started by another operator')
    }
    const child = session.child
    updateSession(session, {
        status: 'cancelled',
        authUrl: null,
        message: 'OpenAI Codex OAuth session cancelled',
        child: null,
        completedAt: new Date(),
    })
    await removeAuthUrlFile(session)
    await closeCallbackPortBlocker(session)
    if (session.timeout) {
        clearTimeout(session.timeout)
        session.timeout = null
    }
    if (child) {
        child.kill('SIGTERM')
    }
    await appendCodexAudit({
        actorUserId: input.actorUserId,
        roomId: input.roomId,
        action: 'codex_oauth.cancelled',
        status: session.status,
        message: session.message,
    })
    return toSnapshot(session)
}

export const __testing = {
    chunkToText,
    openClawOAuthExpectScript,
    stripAnsi,
    validateRedirectUrlValue,
}
