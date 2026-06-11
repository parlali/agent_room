import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    appProviderConnectionRepository,
    appSettingsRepository,
    auditRepository,
    providerValidationRepository,
} from '../db/repositories'
import { providerCatalog, resolveProviderBaseUrl } from './provider-config'
import {
    inspectCodexAppAuthStatusSync,
    writeCodexPiAuthFromCliAuthSync,
    type CodexAppAuthStatus,
} from './codex-auth'
import { listReadyProviders } from './operator-configuration/provider-resolution'

export const codexDeviceAuthSessionStatuses = [
    'idle',
    'starting',
    'awaiting_verification',
    'complete',
    'failed',
    'cancelled',
    'expired',
] as const

export type CodexDeviceAuthSessionStatus = (typeof codexDeviceAuthSessionStatuses)[number]

export interface CodexDeviceAuthSessionSnapshot {
    status: CodexDeviceAuthSessionStatus
    verificationUrl: string | null
    userCode: string | null
    message: string
    startedAt: string | null
    updatedAt: string | null
    completedAt: string | null
    auth: CodexAppAuthStatus
}

interface CodexDeviceAuthSessionState {
    actorUserId: string
    status: CodexDeviceAuthSessionStatus
    verificationUrl: string | null
    userCode: string | null
    message: string
    startedAt: Date
    updatedAt: Date
    completedAt: Date | null
    codexHome: string
    process: ChildProcess | null
    timeout: ReturnType<typeof setTimeout> | null
    poll: ReturnType<typeof setInterval> | null
    output: string
}

const sessionKey = 'app'
const sessions = new Map<string, CodexDeviceAuthSessionState>()
const codexDeviceAuthTimeoutMs = 15 * 60 * 1000
const ansiEscapePattern = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g')
const verificationUrlPattern = /https:\/\/auth\.openai\.com\/codex\/device\b[^\s]*/i
const verificationCodePattern = /([A-Z0-9]{4}-[A-Z0-9]{4,8}|\d{6})/
const localhostCallbackPattern = /localhost|127\.0\.0\.1|\/auth\/callback/i

function isActiveSession(session: CodexDeviceAuthSessionState): boolean {
    return session.status === 'starting' || session.status === 'awaiting_verification'
}

function toSnapshot(session: CodexDeviceAuthSessionState | null): CodexDeviceAuthSessionSnapshot {
    return {
        status: session?.status ?? 'idle',
        verificationUrl: session?.verificationUrl ?? null,
        userCode: session?.userCode ?? null,
        message: session?.message ?? inspectCodexAppAuthStatusSync().message,
        startedAt: session?.startedAt.toISOString() ?? null,
        updatedAt: session?.updatedAt.toISOString() ?? null,
        completedAt: session?.completedAt?.toISOString() ?? null,
        auth: inspectCodexAppAuthStatusSync(),
    }
}

function updateSession(
    session: CodexDeviceAuthSessionState,
    patch: Partial<
        Pick<
            CodexDeviceAuthSessionState,
            'status' | 'verificationUrl' | 'userCode' | 'message' | 'completedAt'
        >
    >,
) {
    Object.assign(session, patch)
    session.updatedAt = new Date()
}

function cleanupSessionProcess(session: CodexDeviceAuthSessionState) {
    if (session.timeout) {
        clearTimeout(session.timeout)
        session.timeout = null
    }
    if (session.poll) {
        clearInterval(session.poll)
        session.poll = null
    }
    if (session.process && !session.process.killed) {
        session.process.kill('SIGTERM')
    }
    try {
        rmSync(session.codexHome, {
            recursive: true,
            force: true,
        })
    } catch {}
}

async function appendAudit(input: {
    actorUserId: string
    action: string
    status: CodexDeviceAuthSessionStatus
    message: string
}) {
    await auditRepository.appendEvent({
        actorUserId: input.actorUserId,
        roomId: null,
        action: input.action,
        payload: {
            status: input.status,
            message: input.message,
        },
    })
}

async function ensureCodexProviderConnection(actorUserId: string) {
    const existing = await appProviderConnectionRepository.findByProvider('openai-codex')
    if (existing) {
        return existing
    }

    const entry = providerCatalog.find((provider) => provider.provider === 'openai-codex')
    if (!entry) {
        throw new Error('Codex app server provider is not available in this build')
    }

    return appProviderConnectionRepository.upsert({
        id: randomUUID(),
        label: entry.label,
        provider: entry.provider,
        authMode: 'oauth',
        api: entry.api,
        baseUrl: resolveProviderBaseUrl({
            provider: entry.provider,
            api: entry.api,
            baseUrl: null,
        }),
        defaultModel: entry.model,
        fallbackModels: [],
        credentialSecretId: null,
        status: 'invalid',
        validationMessage: 'Codex app server login is missing',
        lastValidatedAt: new Date(),
        createdByUserId: actorUserId,
    })
}

async function markCodexProviderValidated(input: {
    actorUserId: string
    status: CodexAppAuthStatus
}) {
    const provider = await ensureCodexProviderConnection(input.actorUserId)
    const completedAt = new Date()
    const saved = await appProviderConnectionRepository.updateValidation({
        id: provider.id,
        status: input.status.ready ? 'ready' : 'invalid',
        validationMessage: input.status.message,
        lastValidatedAt: completedAt,
    })
    await providerValidationRepository.appendAttempt({
        providerConnectionId: saved.id,
        roomId: null,
        provider: saved.provider,
        authMode: saved.authMode,
        api: saved.api,
        baseUrl: saved.baseUrl,
        model: saved.defaultModel,
        status: saved.status,
        message: saved.validationMessage ?? input.status.message,
        startedAt: completedAt,
        completedAt,
    })

    if (saved.status === 'ready') {
        const settings = await appSettingsRepository.getOrCreate()
        if (!settings.defaultProviderConnectionId) {
            const providers = await appProviderConnectionRepository.list()
            const readyProviders = listReadyProviders(providers, input.status)
            if (readyProviders.length >= 1) {
                await appSettingsRepository.update({
                    defaultProviderConnectionId: readyProviders[0]?.id ?? saved.id,
                    defaultModel: null,
                    onboardingCompletedAt: settings.onboardingCompletedAt ?? new Date(),
                })
            }
        }
    }
}

function extractDeviceAuthFields(output: string): {
    verificationUrl: string | null
    userCode: string | null
} {
    const normalizedOutput = output.replace(ansiEscapePattern, '')
    const verificationUrl = normalizedOutput.match(verificationUrlPattern)?.[0] ?? null
    const codeNearLabel =
        normalizedOutput.match(
            new RegExp(
                `(?:one-time code|code|enter|paste)[\\s\\S]{0,200}\\b${verificationCodePattern.source}\\b`,
                'i',
            ),
        )?.[1] ?? null
    const fallbackCode =
        normalizedOutput.match(new RegExp(`\\b${verificationCodePattern.source}\\b`))?.[1] ?? null
    return {
        verificationUrl,
        userCode: codeNearLabel ?? fallbackCode,
    }
}

function childEnv(codexHome: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        CODEX_HOME: codexHome,
        HOME: codexHome,
    }
    delete env.OPENAI_API_KEY
    delete env.OPENROUTER_API_KEY
    delete env.ANTHROPIC_API_KEY
    delete env.GOOGLE_API_KEY
    return env
}

async function finalizeSession(input: {
    session: CodexDeviceAuthSessionState
    status: CodexDeviceAuthSessionStatus
    message: string
    action: string
}) {
    cleanupSessionProcess(input.session)
    updateSession(input.session, {
        status: input.status,
        verificationUrl: null,
        userCode: null,
        message: input.message,
        completedAt: new Date(),
    })
    await appendAudit({
        actorUserId: input.session.actorUserId,
        action: input.action,
        status: input.status,
        message: input.message,
    })
}

async function tryCompleteFromCliAuth(session: CodexDeviceAuthSessionState) {
    if (!isActiveSession(session)) {
        return
    }
    const cliAuthPath = join(session.codexHome, 'auth.json')
    if (!existsSync(cliAuthPath)) {
        return
    }

    try {
        const auth = writeCodexPiAuthFromCliAuthSync({
            cliAuthJson: readFileSync(cliAuthPath, 'utf8'),
        })
        await markCodexProviderValidated({
            actorUserId: session.actorUserId,
            status: auth,
        })
        await finalizeSession({
            session,
            status: 'complete',
            message: auth.message,
            action: 'codex_device_auth.completed',
        })
    } catch (error) {
        await finalizeSession({
            session,
            status: 'failed',
            message: error instanceof Error ? error.message : 'Codex device login failed',
            action: 'codex_device_auth.failed',
        })
    }
}

function handleOutput(session: CodexDeviceAuthSessionState, chunk: Buffer | string) {
    if (!isActiveSession(session)) {
        return
    }
    session.output = `${session.output}${chunk.toString()}`
    if (localhostCallbackPattern.test(session.output)) {
        void finalizeSession({
            session,
            status: 'failed',
            message: 'Codex CLI attempted localhost redirect auth instead of device auth',
            action: 'codex_device_auth.failed',
        })
        return
    }

    const fields = extractDeviceAuthFields(session.output)
    if (fields.verificationUrl || fields.userCode) {
        updateSession(session, {
            status:
                fields.verificationUrl && fields.userCode ? 'awaiting_verification' : 'starting',
            verificationUrl: fields.verificationUrl ?? session.verificationUrl,
            userCode: fields.userCode ?? session.userCode,
            message:
                fields.verificationUrl && fields.userCode
                    ? 'OpenAI verification code is ready'
                    : 'Waiting for OpenAI verification code',
        })
    }
}

export async function getCodexDeviceAuthSessionSnapshot(): Promise<CodexDeviceAuthSessionSnapshot> {
    const session = sessions.get(sessionKey) ?? null
    if (session?.status === 'starting' || session?.status === 'awaiting_verification') {
        await tryCompleteFromCliAuth(session)
    }
    return toSnapshot(sessions.get(sessionKey) ?? null)
}

export async function startCodexDeviceAuthSession(
    actorUserId: string,
): Promise<CodexDeviceAuthSessionSnapshot> {
    const existing = sessions.get(sessionKey)
    if (existing && isActiveSession(existing)) {
        return toSnapshot(existing)
    }

    await ensureCodexProviderConnection(actorUserId)
    const codexHome = mkdtempSync(join(tmpdir(), 'agent-room-codex-device-auth-'))
    const session: CodexDeviceAuthSessionState = {
        actorUserId,
        status: 'starting',
        verificationUrl: null,
        userCode: null,
        message: 'Starting OpenAI Codex device login',
        startedAt: new Date(),
        updatedAt: new Date(),
        completedAt: null,
        codexHome,
        process: null,
        timeout: null,
        poll: null,
        output: '',
    }
    sessions.set(sessionKey, session)

    session.timeout = setTimeout(() => {
        void finalizeSession({
            session,
            status: 'expired',
            message: 'OpenAI verification code expired',
            action: 'codex_device_auth.expired',
        })
    }, codexDeviceAuthTimeoutMs)
    session.poll = setInterval(() => {
        void tryCompleteFromCliAuth(session)
    }, 1000)

    const child = spawn(
        'codex',
        ['login', '--device-auth', '-c', 'cli_auth_credentials_store="file"'],
        {
            env: childEnv(codexHome),
            stdio: ['ignore', 'pipe', 'pipe'],
        },
    )
    session.process = child

    child.stdout.on('data', (chunk) => handleOutput(session, chunk))
    child.stderr.on('data', (chunk) => handleOutput(session, chunk))
    child.on('error', (error) => {
        void finalizeSession({
            session,
            status: 'failed',
            message: error.message,
            action: 'codex_device_auth.failed',
        })
    })
    child.on('exit', (code) => {
        if (!isActiveSession(session)) {
            return
        }
        void tryCompleteFromCliAuth(session).then(() => {
            if (session.status === 'complete') {
                return
            }
            void finalizeSession({
                session,
                status: 'failed',
                message: `Codex device login exited before authorization completed${code === null ? '' : ` with code ${code}`}`,
                action: 'codex_device_auth.failed',
            })
        })
    })

    await appendAudit({
        actorUserId,
        action: 'codex_device_auth.started',
        status: 'starting',
        message: session.message,
    })

    return toSnapshot(session)
}

export async function cancelCodexDeviceAuthSession(_input: {
    actorUserId: string
}): Promise<CodexDeviceAuthSessionSnapshot> {
    const session = sessions.get(sessionKey)
    if (!session) {
        return toSnapshot(null)
    }
    await finalizeSession({
        session,
        status: 'cancelled',
        message: 'OpenAI Codex device login cancelled',
        action: 'codex_device_auth.cancelled',
    })
    return toSnapshot(session)
}

export const __testing = {
    extractDeviceAuthFields,
    childEnv,
}
