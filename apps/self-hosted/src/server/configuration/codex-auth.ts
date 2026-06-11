import { Buffer } from 'node:buffer'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { JsonValue } from '#/domain/domain-types'
import { getAppEnv } from '../config/env'

export type CodexAppAuthState = 'missing' | 'ready' | 'invalid'

export interface CodexAppAuthStatus {
    ready: boolean
    status: CodexAppAuthState
    accountId: string | null
    expiresAt: string | null
    message: string
}

export interface CodexPiOAuthCredential {
    type: 'oauth'
    access: string
    refresh: string
    expires: number
    accountId: string
}

export function resolveCodexProviderAuthDir(dataDir = getAppEnv().dataDir): string {
    return join(dataDir, 'system', 'providers', 'openai-codex')
}

export function resolveCodexPiAuthPath(dataDir = getAppEnv().dataDir): string {
    return join(resolveCodexProviderAuthDir(dataDir), 'auth.json')
}

export function inspectCodexAppAuthStatusSync(input?: { authPath?: string }): CodexAppAuthStatus {
    const authPath = input?.authPath ?? resolveCodexPiAuthPath()

    if (!existsSync(authPath)) {
        return invalidStatus('missing', 'Codex app server login is missing')
    }

    let parsed: unknown
    try {
        parsed = JSON.parse(readFileSync(authPath, 'utf8'))
    } catch {
        return invalidStatus('invalid', 'Codex app server login could not be parsed')
    }

    const credential = readCodexCredentialFromPiAuth(parsed)
    if (!credential) {
        return invalidStatus('invalid', 'Codex app server login is incomplete')
    }
    if (credential.expires <= Date.now()) {
        return invalidStatus('invalid', 'Codex app server login is expired')
    }

    return {
        ready: true,
        status: 'ready',
        accountId: credential.accountId,
        expiresAt: new Date(credential.expires).toISOString(),
        message: 'Codex app server login is active',
    }
}

export function readCodexPiAuthCredentialSync(input?: {
    authPath?: string
}): CodexPiOAuthCredential | null {
    const authPath = input?.authPath ?? resolveCodexPiAuthPath()
    if (!existsSync(authPath)) {
        return null
    }

    try {
        return readCodexCredentialFromPiAuth(JSON.parse(readFileSync(authPath, 'utf8')))
    } catch {
        return null
    }
}

export function writeCodexPiAuthCredentialSync(input: {
    authPath?: string
    credential: CodexPiOAuthCredential
}): CodexAppAuthStatus {
    const authPath = input.authPath ?? resolveCodexPiAuthPath()
    mkdirSync(dirname(authPath), {
        recursive: true,
        mode: 0o700,
    })
    writeFileSync(
        authPath,
        `${JSON.stringify(
            {
                'openai-codex': input.credential,
            },
            null,
            4,
        )}\n`,
        {
            encoding: 'utf8',
            mode: 0o600,
        },
    )
    chmodSync(dirname(authPath), 0o700)
    chmodSync(authPath, 0o600)
    return inspectCodexAppAuthStatusSync({ authPath })
}

export function writeCodexPiAuthFromCliAuthSync(input: {
    authPath?: string
    cliAuthJson: string
    nowMs?: number
}): CodexAppAuthStatus {
    let parsed: unknown
    try {
        parsed = JSON.parse(input.cliAuthJson)
    } catch {
        throw new Error('Codex device login wrote invalid auth data')
    }

    const credential = convertCodexCliAuthToPiCredential(parsed, input.nowMs ?? Date.now())
    return writeCodexPiAuthCredentialSync({
        authPath: input.authPath,
        credential,
    })
}

export function convertCodexCliAuthToPiCredential(
    parsed: unknown,
    nowMs = Date.now(),
): CodexPiOAuthCredential {
    const auth = readRecord(parsed)
    const tokens = readRecord(auth.tokens)
    const authMode = readString(auth.auth_mode)
    const access = readString(tokens.access_token)
    const refresh = readString(tokens.refresh_token)
    const accountId = readString(tokens.account_id) ?? accountIdFromAccessToken(access)

    if (authMode !== 'chatgpt') {
        throw new Error('Codex device login did not produce a ChatGPT auth file')
    }
    if (!access || !refresh || !accountId) {
        throw new Error('Codex device login auth data is incomplete')
    }

    const accessTokenExpiry = accessTokenExpiryMs(access)
    const expires = accessTokenExpiry ?? codexAccessTokenFallbackExpiryMs(nowMs, accountId)

    return {
        type: 'oauth',
        access,
        refresh,
        expires,
        accountId,
    }
}

function codexAccessTokenFallbackExpiryMs(nowMs: number, accountId: string): number {
    const expires = nowMs + 5 * 60 * 1000
    console.warn(
        `Codex device login access token for account ${accountId} did not include a parseable exp claim; using bounded fallback expiry ${new Date(expires).toISOString()}`,
    )
    return expires
}

function readCodexCredentialFromPiAuth(value: unknown): CodexPiOAuthCredential | null {
    const root = readRecord(value)
    const credential = readRecord(root['openai-codex'])
    const type = readString(credential.type)
    const access = readString(credential.access)
    const refresh = readString(credential.refresh)
    const accountId = readString(credential.accountId)
    const expires = typeof credential.expires === 'number' ? credential.expires : null

    if (type !== 'oauth' || !access || !refresh || !accountId || !expires) {
        return null
    }

    return {
        type: 'oauth',
        access,
        refresh,
        expires,
        accountId,
    }
}

function invalidStatus(status: Exclude<CodexAppAuthState, 'ready'>, message: string) {
    return {
        ready: false,
        status,
        accountId: null,
        expiresAt: null,
        message,
    }
}

function readRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {}
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null
}

function accessTokenExpiryMs(accessToken: string): number | null {
    const payload = decodeJwtPayload(accessToken)
    const exp = payload && typeof payload.exp === 'number' ? payload.exp : null
    return exp ? exp * 1000 : null
}

function accountIdFromAccessToken(accessToken: string | null): string | null {
    if (!accessToken) {
        return null
    }
    const payload = decodeJwtPayload(accessToken)
    const auth = readRecord(payload?.['https://api.openai.com/auth'])
    return readString(auth.chatgpt_account_id)
}

function decodeJwtPayload(token: string): Record<string, JsonValue> | null {
    const payload = token.split('.')[1]
    if (!payload) {
        return null
    }

    try {
        const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
        return readRecord(decoded) as Record<string, JsonValue>
    } catch {
        return null
    }
}
