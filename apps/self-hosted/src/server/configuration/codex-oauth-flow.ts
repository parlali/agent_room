import { randomUUID } from 'node:crypto'
import { AuthStorage } from '@mariozechner/pi-coding-agent'
import {
    appProviderConnectionRepository,
    appSettingsRepository,
    auditRepository,
    roomRuntimeMetadataRepository,
    roomConfigRepository,
    roomRepository,
} from '../db/repositories'
import type { AppProviderConnectionRecord, ProviderApi } from '#/domain/domain-types'
import { reconcileRoomAutostart } from '../rooms/room-autostart'
import { ensureRoomFilesystemLayout } from '../rooms/room-paths'
import { getCodexAuthProfilePath, inspectCodexAuthStatus } from './codex-auth'
import { assertRoomConfigurationStartable } from './operator-configuration'

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
    provider: string
    api: ProviderApi
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
    manualResolve: ((value: string) => void) | null
    manualReject: ((error: Error) => void) | null
    timeout: ReturnType<typeof setTimeout> | null
    flowId: string
}

const sessions = new Map<string, CodexOAuthSessionState>()
const codexOAuthTimeoutMs = 15 * 60 * 1000

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
            | 'status'
            | 'authUrl'
            | 'message'
            | 'completedAt'
            | 'manualResolve'
            | 'manualReject'
            | 'timeout'
        >
    >,
) {
    Object.assign(session, patch)
    session.updatedAt = new Date()
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
        provider: provider.provider,
        api: provider.api,
    }
}

async function finalizeSession(input: {
    session: CodexOAuthSessionState
    status: CodexOAuthSessionStatus
    message: string
    action: string
}) {
    if (input.session.timeout) {
        clearTimeout(input.session.timeout)
    }
    updateSession(input.session, {
        status: input.status,
        message: input.message,
        authUrl: input.status === 'complete' ? input.session.authUrl : null,
        completedAt: new Date(),
        manualResolve: null,
        manualReject: null,
        timeout: null,
    })
    await appendCodexAudit({
        actorUserId: input.session.actorUserId,
        roomId: input.session.roomId,
        action: input.action,
        status: input.status,
        message: input.message,
    })
}

async function clearStaleConfigurationBlocker(roomId: string): Promise<void> {
    const [room, metadata] = await Promise.all([
        roomRepository.findRoomById(roomId),
        roomRuntimeMetadataRepository.findByRoomId(roomId),
    ])
    if (!room || room.status !== 'failed') {
        return
    }
    if (!metadata?.lastError?.startsWith('Room configuration is blocked:')) {
        return
    }

    await assertRoomConfigurationStartable(roomId)
    await roomRuntimeMetadataRepository.clearLastError(roomId)
    await roomRepository.updateRoomStatus(roomId, 'stopped')
}

async function reconcileRuntimeAfterCodexOAuth(session: CodexOAuthSessionState): Promise<void> {
    try {
        await reconcileRoomAutostart({
            roomId: session.roomId,
            actorUserId: session.actorUserId,
            trigger: 'codex_oauth_completed',
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'runtime reconcile failed'
        console.error(
            `Failed to reconcile room runtime after Codex OAuth for ${session.roomId}`,
            message,
        )
        updateSession(session, {
            message: `${session.message}; runtime reconcile failed: ${message}`,
        })
    }
}

async function runPiCodexLogin(session: CodexOAuthSessionState, target: CodexOAuthTarget) {
    try {
        await ensureRoomFilesystemLayout(target.roomId)
        const authStorage = AuthStorage.create(session.profilePath)
        await authStorage.login('openai-codex', {
            onAuth: (info) => {
                updateSession(session, {
                    status: 'awaiting_redirect',
                    authUrl: info.url,
                    message: 'OpenAI Codex OAuth URL is ready',
                })
            },
            onPrompt: async () =>
                new Promise<string>((resolve, reject) => {
                    updateSession(session, {
                        status: 'awaiting_redirect',
                        message: 'Paste the OpenAI Codex redirect URL to finish login',
                        manualResolve: resolve,
                        manualReject: reject,
                    })
                }),
            onProgress: (message) => {
                if (session.status !== 'cancelled' && session.status !== 'expired') {
                    updateSession(session, {
                        message,
                    })
                }
            },
            onManualCodeInput: () =>
                new Promise<string>((resolve, reject) => {
                    updateSession(session, {
                        manualResolve: resolve,
                        manualReject: reject,
                    })
                }),
        })

        const authStatus = await inspectCodexAuthStatus(session.roomId)
        if (authStatus.ready) {
            await clearStaleConfigurationBlocker(session.roomId)
            await finalizeSession({
                session,
                status: 'complete',
                message: authStatus.message,
                action: 'codex_oauth.completed',
            })
            await reconcileRuntimeAfterCodexOAuth(session)
            return
        }

        await finalizeSession({
            session,
            status: 'failed',
            message: authStatus.message,
            action: 'codex_oauth.failed',
        })
    } catch (error) {
        if (session.status === 'cancelled' || session.status === 'expired') {
            return
        }
        await finalizeSession({
            session,
            status: 'failed',
            message: error instanceof Error ? error.message : 'OpenAI Codex OAuth failed',
            action: 'codex_oauth.failed',
        })
    }
}

export async function getCodexOAuthSessionSnapshot(
    roomId: string,
): Promise<CodexOAuthSessionSnapshot> {
    const existing = sessions.get(roomId)
    if (existing) {
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
    if (current && ['starting', 'awaiting_redirect', 'submitting'].includes(current.status)) {
        return toSnapshot(current)
    }

    const target = await resolveCodexOAuthTarget(roomId)
    const profilePath = getCodexAuthProfilePath(roomId)
    const session: CodexOAuthSessionState = {
        roomId,
        actorUserId,
        status: 'starting',
        authUrl: null,
        profilePath,
        message: 'Starting OpenAI Codex OAuth with Pi',
        startedAt: new Date(),
        updatedAt: new Date(),
        completedAt: null,
        manualResolve: null,
        manualReject: null,
        timeout: null,
        flowId: randomUUID(),
    }
    session.timeout = setTimeout(() => {
        updateSession(session, {
            status: 'expired',
            authUrl: null,
            message: 'OpenAI Codex OAuth session expired before completion',
            completedAt: new Date(),
        })
        session.manualReject?.(new Error('OpenAI Codex OAuth session expired before completion'))
        void appendCodexAudit({
            actorUserId: session.actorUserId,
            roomId: session.roomId,
            action: 'codex_oauth.expired',
            status: session.status,
            message: session.message,
        })
    }, codexOAuthTimeoutMs)
    sessions.set(roomId, session)

    await appendCodexAudit({
        actorUserId,
        roomId,
        action: 'codex_oauth.started',
        status: session.status,
        message: 'Started OpenAI Codex OAuth process through Pi',
    })

    void runPiCodexLogin(session, target)

    return toSnapshot(session)
}

export async function submitCodexOAuthRedirect(input: {
    roomId: string
    redirectUrl: string
    actorUserId: string
}): Promise<CodexOAuthSessionSnapshot> {
    const session = sessions.get(input.roomId)
    if (!session) {
        throw new Error('No active OpenAI Codex OAuth session for this room')
    }
    if (session.actorUserId !== input.actorUserId) {
        throw new Error('OpenAI Codex OAuth session was started by another operator')
    }
    if (session.status !== 'awaiting_redirect') {
        throw new Error('OpenAI Codex OAuth session is not waiting for a redirect URL')
    }

    const redirectUrl = validateRedirectUrlValue(input.redirectUrl)
    const resolve = session.manualResolve
    if (!resolve) {
        throw new Error('OpenAI Codex OAuth session is not ready for manual redirect input')
    }
    updateSession(session, {
        status: 'submitting',
        message: 'Submitting redirect URL to Pi',
    })
    resolve(redirectUrl)
    updateSession(session, {
        manualResolve: null,
        manualReject: null,
    })
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
    if (session.timeout) {
        clearTimeout(session.timeout)
    }
    session.manualReject?.(new Error('OpenAI Codex OAuth session cancelled'))
    updateSession(session, {
        status: 'cancelled',
        authUrl: null,
        message: 'OpenAI Codex OAuth session cancelled',
        completedAt: new Date(),
        manualResolve: null,
        manualReject: null,
        timeout: null,
    })
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
    reconcileRuntimeAfterCodexOAuth,
    validateRedirectUrlValue,
}
