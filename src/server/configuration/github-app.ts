import { randomBytes } from 'node:crypto'
import type {
    AppGitHubAppRecord,
    AppGitHubInstallationRecord,
    AppGitHubUserConnectionRecord,
    JsonValue,
    MaterializedGitHubBinding,
    RoomGitHubBindingRecord,
} from '../domain/types'
import {
    appGitHubAppRepository,
    appGitHubInstallationRepository,
    appGitHubManifestSessionRepository,
    appGitHubUserAuthSessionRepository,
    appGitHubUserConnectionRepository,
    auditRepository,
    roomGitHubBindingRepository,
    secretRepository,
} from '../db/repositories'
import { getAppEnv } from '../config/env'
import {
    decryptSecretRecord,
    resolveSecret,
    upsertEncryptedSecret,
} from './operator-configuration/secrets'
import type {
    GitHubAppSummary,
    GitHubAccountSummary,
    GitHubInstallationSummary,
    GitHubIntegrationSummary,
    GitHubRepositorySummary,
    GitHubRoomBindingSummary,
    GitHubUserConnectionSummary,
} from './operator-configuration/contracts'
import {
    createGithubJwt,
    githubApiBase,
    githubApiVersion,
    githubTokenEnvKey,
    githubWebBase,
    installationTokenPermissions,
    isRecord,
    manifestAppName,
    manifestTtlMs,
    normalizeOwner,
    normalizePublicOrigin,
    normalizeRepositories,
    pkceChallenge,
    repositoryNamesForInstallation,
    stateHash,
    toStringArray,
    toStringRecord,
} from './github-app-helpers'

interface GitHubManifestStart {
    postUrl: string
    manifest: string
    state: string
    expiresAt: string
}

interface GitHubUserAuthorizationStart {
    authorizeUrl: string
    state: string
    expiresAt: string
}

type GitHubCallbackResult =
    | {
          kind: 'app'
          github: GitHubIntegrationSummary
      }
    | {
          kind: 'user'
          github: GitHubIntegrationSummary
      }

interface InstallationToken {
    token: string
    expiresAt: string
}

class GitHubRequestError extends Error {
    readonly status: number
    readonly path: string

    constructor(input: { message: string; status: number; path: string }) {
        super(input.message)
        this.name = 'GitHubRequestError'
        this.status = input.status
        this.path = input.path
    }
}

async function githubRequest<T>(input: {
    method: 'GET' | 'POST'
    path: string
    token?: string | null
    body?: unknown
}): Promise<T> {
    const response = await fetch(`${githubApiBase}${input.path}`, {
        method: input.method,
        headers: {
            accept: 'application/vnd.github+json',
            'content-type': 'application/json',
            'x-github-api-version': githubApiVersion,
            ...(input.token ? { authorization: `Bearer ${input.token}` } : {}),
        },
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
    })
    const payload = (await response.json().catch(() => null)) as unknown
    if (!response.ok) {
        const message =
            isRecord(payload) && typeof payload.message === 'string'
                ? payload.message
                : `GitHub returned ${response.status}`
        throw new GitHubRequestError({
            message,
            status: response.status,
            path: input.path,
        })
    }
    return payload as T
}

async function githubOAuthRequest<T>(input: {
    path: string
    body: Record<string, string>
}): Promise<T> {
    const response = await fetch(`${githubWebBase}${input.path}`, {
        method: 'POST',
        headers: {
            accept: 'application/json',
            'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(input.body),
    })
    const payload = (await response.json().catch(() => null)) as unknown
    if (!response.ok || (isRecord(payload) && typeof payload.error === 'string')) {
        const message =
            isRecord(payload) && typeof payload.error_description === 'string'
                ? payload.error_description
                : isRecord(payload) && typeof payload.error === 'string'
                  ? payload.error
                  : `GitHub returned ${response.status}`
        throw new GitHubRequestError({
            message,
            status: response.status,
            path: input.path,
        })
    }
    return payload as T
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error'
}

async function resolveGitHubAppSecrets(app: AppGitHubAppRecord): Promise<{
    privateKey: string
}> {
    const privateKeySecret = await resolveSecret(app.privateKeySecretId)
    if (!privateKeySecret) {
        throw new Error('GitHub App private key is missing')
    }
    return {
        privateKey: decryptSecretRecord(privateKeySecret, getAppEnv().encryptionKey),
    }
}

async function resolveGitHubAppClientSecret(app: AppGitHubAppRecord): Promise<string> {
    const clientSecretRecord = await resolveSecret(app.clientSecretSecretId)
    if (!clientSecretRecord) {
        throw new Error('GitHub App client secret is missing')
    }
    return decryptSecretRecord(clientSecretRecord, getAppEnv().encryptionKey)
}

async function appJwt(): Promise<string> {
    const app = await appGitHubAppRepository.get()
    if (!app) {
        throw new Error('GitHub App is not configured')
    }
    if (app.status !== 'ready') {
        throw new Error(app.validationMessage ?? 'GitHub App is not ready')
    }
    const { privateKey } = await resolveGitHubAppSecrets(app)
    return createGithubJwt(app, privateKey)
}

function summarizeGitHubApp(app: AppGitHubAppRecord | null): GitHubAppSummary {
    if (!app) {
        return {
            configured: false,
            appId: null,
            slug: null,
            name: null,
            clientId: null,
            htmlUrl: null,
            status: null,
            validationMessage: null,
            lastValidatedAt: null,
            updatedAt: null,
            installUrl: null,
        }
    }
    return {
        configured: true,
        appId: app.appId,
        slug: app.slug,
        name: app.name,
        clientId: app.clientId,
        htmlUrl: app.htmlUrl,
        status: app.status,
        validationMessage: app.validationMessage,
        lastValidatedAt: app.lastValidatedAt?.toISOString() ?? null,
        updatedAt: app.updatedAt.toISOString(),
        installUrl: installationInstallUrl(app),
    }
}

function summarizeInstallation(
    installation: AppGitHubInstallationRecord,
): GitHubInstallationSummary {
    return {
        installationId: installation.installationId,
        accountLogin: installation.accountLogin,
        accountType: installation.accountType,
        targetType: installation.targetType,
        htmlUrl: installation.htmlUrl,
        repositorySelection: installation.repositorySelection,
        permissions: toStringRecord(installation.permissions),
        suspendedAt: installation.suspendedAt?.toISOString() ?? null,
        status: installation.status,
        lastSyncedAt: installation.lastSyncedAt.toISOString(),
        updatedAt: installation.updatedAt.toISOString(),
    }
}

function summarizeGitHubUserConnection(input: {
    connection: AppGitHubUserConnectionRecord | null
    status?: 'ready' | 'invalid'
    validationMessage?: string | null
}): GitHubUserConnectionSummary {
    if (!input.connection) {
        return {
            connected: false,
            login: null,
            name: null,
            avatarUrl: null,
            htmlUrl: null,
            status: null,
            validationMessage: null,
            lastAuthorizedAt: null,
            updatedAt: null,
        }
    }
    return {
        connected: true,
        login: input.connection.login,
        name: input.connection.name,
        avatarUrl: input.connection.avatarUrl,
        htmlUrl: input.connection.htmlUrl,
        status: input.status ?? 'ready',
        validationMessage: input.validationMessage ?? null,
        lastAuthorizedAt: input.connection.lastAuthorizedAt.toISOString(),
        updatedAt: input.connection.updatedAt.toISOString(),
    }
}

function installationInstallUrl(app: AppGitHubAppRecord | null): string | null {
    if (!app?.slug) return null
    const url = new URL(`${githubWebBase}/apps/${app.slug}/installations/new`)
    url.searchParams.set('state', 'settings')
    return url.toString()
}

function putAccount(
    accounts: Map<string, GitHubAccountSummary>,
    account: Partial<GitHubAccountSummary> & { login: string },
) {
    const existing = accounts.get(account.login)
    accounts.set(account.login, {
        login: account.login,
        accountType: account.accountType ?? existing?.accountType ?? 'Unknown',
        avatarUrl: account.avatarUrl ?? existing?.avatarUrl ?? null,
        htmlUrl: account.htmlUrl ?? existing?.htmlUrl ?? null,
        installed: account.installed ?? existing?.installed ?? false,
        installationId: account.installationId ?? existing?.installationId ?? null,
        installationStatus: account.installationStatus ?? existing?.installationStatus ?? null,
        repositorySelection: account.repositorySelection ?? existing?.repositorySelection ?? null,
        installUrl: account.installUrl ?? existing?.installUrl ?? null,
        manageUrl: account.manageUrl ?? existing?.manageUrl ?? null,
        updatedAt: account.updatedAt ?? existing?.updatedAt ?? null,
    })
}

function addInstalledAccounts(input: {
    accounts: Map<string, GitHubAccountSummary>
    installations: AppGitHubInstallationRecord[]
    app: AppGitHubAppRecord | null
}) {
    for (const installation of input.installations) {
        putAccount(input.accounts, {
            login: installation.accountLogin,
            accountType: installation.accountType,
            htmlUrl: installation.htmlUrl,
            installed: installation.status === 'ready',
            installationId: installation.installationId,
            installationStatus: installation.status,
            repositorySelection: installation.repositorySelection,
            installUrl: installation.status === 'ready' ? null : installationInstallUrl(input.app),
            manageUrl: installation.htmlUrl,
            updatedAt: installation.updatedAt.toISOString(),
        })
    }
}

function sortedAccounts(accounts: Map<string, GitHubAccountSummary>): GitHubAccountSummary[] {
    return [...accounts.values()].sort((left, right) => {
        if (left.installed !== right.installed) return left.installed ? -1 : 1
        return left.login.localeCompare(right.login)
    })
}

function tokenExpiry(seconds: unknown): Date | null {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
        return null
    }
    return new Date(Date.now() + seconds * 1000)
}

async function resolveGitHubUserAccessToken(input: {
    app: AppGitHubAppRecord
    connection: AppGitHubUserConnectionRecord
}): Promise<string> {
    const accessTokenSecret = await resolveSecret(input.connection.accessTokenSecretId)
    if (!accessTokenSecret) {
        throw new Error('GitHub user access token is missing')
    }
    const expiresAt = input.connection.accessTokenExpiresAt?.getTime() ?? null
    if (!expiresAt || expiresAt > Date.now() + 60_000) {
        return decryptSecretRecord(accessTokenSecret, getAppEnv().encryptionKey)
    }
    if (
        !input.connection.refreshTokenSecretId ||
        (input.connection.refreshTokenExpiresAt?.getTime() ?? 0) <= Date.now() + 60_000
    ) {
        throw new Error('GitHub user authorization expired')
    }
    const refreshTokenSecret = await resolveSecret(input.connection.refreshTokenSecretId)
    if (!refreshTokenSecret) {
        throw new Error('GitHub user refresh token is missing')
    }
    const clientSecret = await resolveGitHubAppClientSecret(input.app)
    const refreshToken = decryptSecretRecord(refreshTokenSecret, getAppEnv().encryptionKey)
    const payload = await githubOAuthRequest<Record<string, unknown>>({
        path: '/login/oauth/access_token',
        body: {
            client_id: input.app.clientId,
            client_secret: clientSecret,
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
        },
    })
    const nextAccessToken = typeof payload.access_token === 'string' ? payload.access_token : ''
    const nextRefreshToken = typeof payload.refresh_token === 'string' ? payload.refresh_token : ''
    if (!nextAccessToken) {
        throw new Error('GitHub did not return a refreshed user access token')
    }
    const accessTokenRecord = await upsertEncryptedSecret({
        keyName: 'app_github_user:access_token',
        plainText: nextAccessToken,
    })
    const refreshTokenRecord = nextRefreshToken
        ? await upsertEncryptedSecret({
              keyName: 'app_github_user:refresh_token',
              plainText: nextRefreshToken,
          })
        : null
    await appGitHubUserConnectionRepository.upsert({
        githubUserId: input.connection.githubUserId,
        login: input.connection.login,
        name: input.connection.name,
        avatarUrl: input.connection.avatarUrl,
        htmlUrl: input.connection.htmlUrl,
        tokenType: typeof payload.token_type === 'string' ? payload.token_type : 'bearer',
        accessTokenSecretId: accessTokenRecord.id,
        accessTokenExpiresAt: tokenExpiry(payload.expires_in),
        refreshTokenSecretId: refreshTokenRecord?.id ?? input.connection.refreshTokenSecretId,
        refreshTokenExpiresAt:
            tokenExpiry(payload.refresh_token_expires_in) ?? input.connection.refreshTokenExpiresAt,
        createdByUserId: input.connection.createdByUserId,
        lastAuthorizedAt: input.connection.lastAuthorizedAt,
    })
    return nextAccessToken
}

async function listGitHubUserOrgs(token: string): Promise<Record<string, unknown>[]> {
    const orgs: Record<string, unknown>[] = []
    for (let page = 1; page <= 10; page += 1) {
        const payload = await githubRequest<unknown[]>({
            method: 'GET',
            path: `/user/orgs?per_page=100&page=${page}`,
            token,
        })
        for (const entry of payload) {
            if (isRecord(entry)) orgs.push(entry)
        }
        if (payload.length < 100) break
    }
    return orgs
}

async function listGitHubUserInstallations(token: string): Promise<Record<string, unknown>[]> {
    const installations: Record<string, unknown>[] = []
    for (let page = 1; page <= 10; page += 1) {
        const payload = await githubRequest<Record<string, unknown>>({
            method: 'GET',
            path: `/user/installations?per_page=100&page=${page}`,
            token,
        })
        const items = Array.isArray(payload.installations) ? payload.installations : []
        for (const entry of items) {
            if (isRecord(entry)) installations.push(entry)
        }
        if (items.length < 100) break
    }
    return installations
}

async function buildGitHubAccounts(input: {
    app: AppGitHubAppRecord | null
    installations: AppGitHubInstallationRecord[]
    connection: AppGitHubUserConnectionRecord | null
}): Promise<{
    user: GitHubUserConnectionSummary
    accounts: GitHubAccountSummary[]
}> {
    const accounts = new Map<string, GitHubAccountSummary>()
    addInstalledAccounts({
        accounts,
        installations: input.installations,
        app: input.app,
    })
    if (!input.app || input.app.status !== 'ready' || !input.connection) {
        return {
            user: summarizeGitHubUserConnection({ connection: input.connection }),
            accounts: sortedAccounts(accounts),
        }
    }

    try {
        const token = await resolveGitHubUserAccessToken({
            app: input.app,
            connection: input.connection,
        })
        const [userPayload, orgs, userInstallations] = await Promise.all([
            githubRequest<Record<string, unknown>>({
                method: 'GET',
                path: '/user',
                token,
            }),
            listGitHubUserOrgs(token),
            listGitHubUserInstallations(token),
        ])
        const selfLogin = typeof userPayload.login === 'string' ? userPayload.login : ''
        if (selfLogin) {
            putAccount(accounts, {
                login: selfLogin,
                accountType: typeof userPayload.type === 'string' ? userPayload.type : 'User',
                avatarUrl:
                    typeof userPayload.avatar_url === 'string' ? userPayload.avatar_url : null,
                htmlUrl: typeof userPayload.html_url === 'string' ? userPayload.html_url : null,
                installUrl: accounts.get(selfLogin)?.installed
                    ? null
                    : installationInstallUrl(input.app),
            })
        }
        for (const org of orgs) {
            const login = typeof org.login === 'string' ? org.login : ''
            if (!login) continue
            putAccount(accounts, {
                login,
                accountType: typeof org.type === 'string' ? org.type : 'Organization',
                avatarUrl: typeof org.avatar_url === 'string' ? org.avatar_url : null,
                htmlUrl: typeof org.html_url === 'string' ? org.html_url : null,
                installUrl: accounts.get(login)?.installed
                    ? null
                    : installationInstallUrl(input.app),
            })
        }
        for (const installation of userInstallations) {
            const account = isRecord(installation.account) ? installation.account : {}
            const login = typeof account.login === 'string' ? account.login : ''
            if (!login) continue
            putAccount(accounts, {
                login,
                accountType:
                    typeof account.type === 'string'
                        ? account.type
                        : typeof installation.target_type === 'string'
                          ? installation.target_type
                          : 'Unknown',
                avatarUrl: typeof account.avatar_url === 'string' ? account.avatar_url : null,
                htmlUrl: typeof account.html_url === 'string' ? account.html_url : null,
                installed: true,
                installationId: String(installation.id ?? ''),
                installationStatus: installationStatus(installation),
                repositorySelection:
                    typeof installation.repository_selection === 'string'
                        ? installation.repository_selection
                        : null,
                installUrl: null,
                manageUrl: typeof installation.html_url === 'string' ? installation.html_url : null,
            })
        }
        return {
            user: summarizeGitHubUserConnection({ connection: input.connection }),
            accounts: sortedAccounts(accounts),
        }
    } catch (error) {
        return {
            user: summarizeGitHubUserConnection({
                connection: input.connection,
                status: 'invalid',
                validationMessage: describeError(error),
            }),
            accounts: sortedAccounts(accounts),
        }
    }
}

export async function getGitHubIntegrationSummary(): Promise<GitHubIntegrationSummary> {
    const [app, installations, connection] = await Promise.all([
        appGitHubAppRepository.get(),
        appGitHubInstallationRepository.list(),
        appGitHubUserConnectionRepository.get(),
    ])
    const { user, accounts } = await buildGitHubAccounts({
        app,
        installations,
        connection,
    })
    return {
        app: summarizeGitHubApp(app),
        user,
        installations: installations.map(summarizeInstallation),
        accounts,
    }
}

function buildManifest(input: { name: string; publicOrigin: string }): Record<string, unknown> {
    return {
        name: input.name,
        url: input.publicOrigin,
        hook_attributes: {
            url: `${input.publicOrigin}/api/github/events`,
            active: false,
        },
        redirect_url: `${input.publicOrigin}/github/app/callback`,
        callback_urls: [`${input.publicOrigin}/github/app/callback`],
        setup_url: `${input.publicOrigin}/settings`,
        public: true,
        default_permissions: installationTokenPermissions,
        default_events: [],
        request_oauth_on_install: false,
        setup_on_update: true,
    }
}

export async function resetGitHubAppConfiguration(
    actorUserId: string,
): Promise<GitHubIntegrationSummary> {
    const app = await appGitHubAppRepository.get()
    const userConnection = await appGitHubUserConnectionRepository.get()
    await roomGitHubBindingRepository.deleteAll()
    await appGitHubInstallationRepository.deleteAll()
    await appGitHubUserConnectionRepository.delete()
    await appGitHubAppRepository.delete()

    for (const secretId of [
        app?.clientSecretSecretId,
        app?.privateKeySecretId,
        app?.webhookSecretSecretId,
        userConnection?.accessTokenSecretId,
        userConnection?.refreshTokenSecretId,
    ]) {
        if (secretId) {
            await secretRepository.deleteById(secretId)
        }
    }

    await auditRepository.appendEvent({
        actorUserId,
        roomId: null,
        action: 'github_app.reset',
        payload: {
            appId: app?.appId ?? null,
            slug: app?.slug ?? null,
        },
    })

    return getGitHubIntegrationSummary()
}

export async function disconnectGitHubUserAuthorization(
    actorUserId: string,
): Promise<GitHubIntegrationSummary> {
    const userConnection = await appGitHubUserConnectionRepository.get()
    await appGitHubUserConnectionRepository.delete()
    for (const secretId of [
        userConnection?.accessTokenSecretId,
        userConnection?.refreshTokenSecretId,
    ]) {
        if (secretId) {
            await secretRepository.deleteById(secretId)
        }
    }
    await auditRepository.appendEvent({
        actorUserId,
        roomId: null,
        action: 'github_user.disconnected',
        payload: {
            login: userConnection?.login ?? null,
            githubUserId: userConnection?.githubUserId ?? null,
        },
    })
    return getGitHubIntegrationSummary()
}

export async function startGitHubAppManifest(input: {
    publicOrigin: string
    targetOwner?: string | null
    actorUserId: string
}): Promise<GitHubManifestStart> {
    const publicOrigin = normalizePublicOrigin(input.publicOrigin)
    const targetOwner = normalizeOwner(input.targetOwner)
    const appName = manifestAppName(publicOrigin)
    const state = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + manifestTtlMs)
    await appGitHubManifestSessionRepository.create({
        stateHash: stateHash(state),
        actorUserId: input.actorUserId,
        publicOrigin,
        targetOwner,
        expiresAt,
    })
    const manifest = JSON.stringify(buildManifest({ name: appName, publicOrigin }))
    const postUrl = targetOwner
        ? `${githubWebBase}/organizations/${encodeURIComponent(targetOwner)}/settings/apps/new?state=${encodeURIComponent(state)}`
        : `${githubWebBase}/settings/apps/new?state=${encodeURIComponent(state)}`

    await auditRepository.appendEvent({
        actorUserId: input.actorUserId,
        roomId: null,
        action: 'github_app.manifest_started',
        payload: {
            appName,
            publicOrigin,
            targetOwner,
            expiresAt: expiresAt.toISOString(),
        },
    })

    return {
        postUrl,
        manifest,
        state,
        expiresAt: expiresAt.toISOString(),
    }
}

export async function startGitHubUserAuthorization(input: {
    publicOrigin: string
    actorUserId: string
}): Promise<GitHubUserAuthorizationStart> {
    const app = await appGitHubAppRepository.get()
    if (!app) {
        throw new Error('GitHub App is not configured')
    }
    if (app.status !== 'ready') {
        throw new Error(app.validationMessage ?? 'GitHub App is not ready')
    }
    const publicOrigin = normalizePublicOrigin(input.publicOrigin)
    const state = randomBytes(32).toString('base64url')
    const codeVerifier = randomBytes(48).toString('base64url')
    const expiresAt = new Date(Date.now() + manifestTtlMs)
    await appGitHubUserAuthSessionRepository.create({
        stateHash: stateHash(state),
        actorUserId: input.actorUserId,
        publicOrigin,
        codeVerifier,
        expiresAt,
    })
    const authorizeUrl = new URL(`${githubWebBase}/login/oauth/authorize`)
    authorizeUrl.searchParams.set('client_id', app.clientId)
    authorizeUrl.searchParams.set('redirect_uri', `${publicOrigin}/github/app/callback`)
    authorizeUrl.searchParams.set('state', state)
    authorizeUrl.searchParams.set('code_challenge', pkceChallenge(codeVerifier))
    authorizeUrl.searchParams.set('code_challenge_method', 'S256')

    await auditRepository.appendEvent({
        actorUserId: input.actorUserId,
        roomId: null,
        action: 'github_user.authorization_started',
        payload: {
            appId: app.appId,
            slug: app.slug,
            publicOrigin,
            expiresAt: expiresAt.toISOString(),
        },
    })

    return {
        authorizeUrl: authorizeUrl.toString(),
        state,
        expiresAt: expiresAt.toISOString(),
    }
}

export async function completeGitHubCallback(input: {
    code: string
    state: string
    actorUserId: string
}): Promise<GitHubCallbackResult> {
    const hashedState = stateHash(input.state)
    const manifestSession = await appGitHubManifestSessionRepository.findByStateHash(hashedState)
    if (manifestSession) {
        return {
            kind: 'app',
            github: await completeGitHubAppManifest(input),
        }
    }
    const userSession = await appGitHubUserAuthSessionRepository.findByStateHash(hashedState)
    if (userSession) {
        return {
            kind: 'user',
            github: await completeGitHubUserAuthorization(input),
        }
    }
    throw new Error('GitHub setup session was not found or is no longer active')
}

export async function completeGitHubAppManifest(input: {
    code: string
    state: string
    actorUserId: string
}): Promise<GitHubIntegrationSummary> {
    const session = await appGitHubManifestSessionRepository.findByStateHash(stateHash(input.state))
    if (!session) {
        throw new Error('GitHub App setup session was not found or is no longer active')
    }
    if (session.actorUserId !== input.actorUserId) {
        throw new Error('GitHub App setup session was started by another operator')
    }
    if (session.status === 'completed') {
        return getGitHubIntegrationSummary()
    }
    if (session.status !== 'pending') {
        throw new Error('GitHub App setup session was not found or is no longer active')
    }
    if (session.expiresAt.getTime() < Date.now()) {
        await appGitHubManifestSessionRepository.updateStatus(session.stateHash, 'expired')
        throw new Error('GitHub App setup session expired')
    }

    try {
        const payload = await githubRequest<Record<string, unknown>>({
            method: 'POST',
            path: `/app-manifests/${encodeURIComponent(input.code)}/conversions`,
        })
        const appId = String(payload.id ?? '')
        const slug = typeof payload.slug === 'string' ? payload.slug : ''
        const name = typeof payload.name === 'string' ? payload.name : slug || 'Agent Room'
        const clientId = typeof payload.client_id === 'string' ? payload.client_id : ''
        const clientSecret = typeof payload.client_secret === 'string' ? payload.client_secret : ''
        const privateKey = typeof payload.pem === 'string' ? payload.pem : ''
        const webhookSecret =
            typeof payload.webhook_secret === 'string' ? payload.webhook_secret : ''
        if (!appId || !slug || !clientId || !clientSecret || !privateKey) {
            throw new Error('GitHub App manifest conversion returned incomplete app credentials')
        }

        const existing = await appGitHubAppRepository.get()
        const [clientSecretRecord, privateKeyRecord, webhookSecretRecord] = await Promise.all([
            upsertEncryptedSecret({
                keyName: 'app_github:client_secret',
                plainText: clientSecret,
            }),
            upsertEncryptedSecret({
                keyName: 'app_github:private_key',
                plainText: privateKey,
            }),
            webhookSecret
                ? upsertEncryptedSecret({
                      keyName: 'app_github:webhook_secret',
                      plainText: webhookSecret,
                  })
                : Promise.resolve(null),
        ])
        const saved = await appGitHubAppRepository.upsert({
            appId,
            slug,
            name,
            clientId,
            clientSecretSecretId: clientSecretRecord.id,
            privateKeySecretId: privateKeyRecord.id,
            webhookSecretSecretId: webhookSecretRecord?.id ?? null,
            htmlUrl: typeof payload.html_url === 'string' ? payload.html_url : null,
            status: 'ready',
            validationMessage: null,
            lastValidatedAt: new Date(),
            createdByUserId: input.actorUserId,
        })

        for (const staleSecretId of [
            existing?.clientSecretSecretId,
            existing?.privateKeySecretId,
            existing?.webhookSecretSecretId,
        ]) {
            if (
                staleSecretId &&
                staleSecretId !== saved.clientSecretSecretId &&
                staleSecretId !== saved.privateKeySecretId &&
                staleSecretId !== saved.webhookSecretSecretId
            ) {
                await secretRepository.deleteById(staleSecretId)
            }
        }

        await appGitHubManifestSessionRepository.updateStatus(session.stateHash, 'completed')
        await auditRepository.appendEvent({
            actorUserId: input.actorUserId,
            roomId: null,
            action: 'github_app.configured',
            payload: {
                appId: saved.appId,
                slug: saved.slug,
                name: saved.name,
                replacedExisting: existing !== null,
            },
        })
        try {
            await refreshGitHubInstallations(input.actorUserId)
        } catch (error) {
            await auditRepository.appendEvent({
                actorUserId: input.actorUserId,
                roomId: null,
                action: 'github_installations.initial_sync_failed',
                payload: {
                    appId: saved.appId,
                    slug: saved.slug,
                    message: describeError(error),
                    status: error instanceof GitHubRequestError ? error.status : null,
                },
            })
        }
        return getGitHubIntegrationSummary()
    } catch (error) {
        await appGitHubManifestSessionRepository.updateStatusIfCurrent({
            stateHash: session.stateHash,
            currentStatus: 'pending',
            nextStatus: 'failed',
        })
        throw error
    }
}

export async function completeGitHubUserAuthorization(input: {
    code: string
    state: string
    actorUserId: string
}): Promise<GitHubIntegrationSummary> {
    const session = await appGitHubUserAuthSessionRepository.findByStateHash(stateHash(input.state))
    if (!session) {
        throw new Error('GitHub authorization session was not found or is no longer active')
    }
    if (session.actorUserId !== input.actorUserId) {
        throw new Error('GitHub authorization session was started by another operator')
    }
    if (session.status === 'completed') {
        return getGitHubIntegrationSummary()
    }
    if (session.status !== 'pending') {
        throw new Error('GitHub authorization session was not found or is no longer active')
    }
    if (session.expiresAt.getTime() < Date.now()) {
        await appGitHubUserAuthSessionRepository.updateStatus(session.stateHash, 'expired')
        throw new Error('GitHub authorization session expired')
    }

    try {
        const app = await appGitHubAppRepository.get()
        if (!app) {
            throw new Error('GitHub App is not configured')
        }
        if (app.status !== 'ready') {
            throw new Error(app.validationMessage ?? 'GitHub App is not ready')
        }
        const clientSecret = await resolveGitHubAppClientSecret(app)
        const tokenPayload = await githubOAuthRequest<Record<string, unknown>>({
            path: '/login/oauth/access_token',
            body: {
                client_id: app.clientId,
                client_secret: clientSecret,
                code: input.code,
                redirect_uri: `${session.publicOrigin}/github/app/callback`,
                code_verifier: session.codeVerifier,
            },
        })
        const accessToken =
            typeof tokenPayload.access_token === 'string' ? tokenPayload.access_token : ''
        if (!accessToken) {
            throw new Error('GitHub did not return a user access token')
        }
        const userPayload = await githubRequest<Record<string, unknown>>({
            method: 'GET',
            path: '/user',
            token: accessToken,
        })
        const githubUserId = String(userPayload.id ?? '')
        const login = typeof userPayload.login === 'string' ? userPayload.login : ''
        if (!githubUserId || !login) {
            throw new Error('GitHub user authorization returned an incomplete profile')
        }
        const [accessTokenRecord, refreshTokenRecord] = await Promise.all([
            upsertEncryptedSecret({
                keyName: 'app_github_user:access_token',
                plainText: accessToken,
            }),
            typeof tokenPayload.refresh_token === 'string' && tokenPayload.refresh_token
                ? upsertEncryptedSecret({
                      keyName: 'app_github_user:refresh_token',
                      plainText: tokenPayload.refresh_token,
                  })
                : Promise.resolve(null),
        ])
        const saved = await appGitHubUserConnectionRepository.upsert({
            githubUserId,
            login,
            name: typeof userPayload.name === 'string' ? userPayload.name : null,
            avatarUrl: typeof userPayload.avatar_url === 'string' ? userPayload.avatar_url : null,
            htmlUrl: typeof userPayload.html_url === 'string' ? userPayload.html_url : null,
            tokenType:
                typeof tokenPayload.token_type === 'string' ? tokenPayload.token_type : 'bearer',
            accessTokenSecretId: accessTokenRecord.id,
            accessTokenExpiresAt: tokenExpiry(tokenPayload.expires_in),
            refreshTokenSecretId: refreshTokenRecord?.id ?? null,
            refreshTokenExpiresAt: tokenExpiry(tokenPayload.refresh_token_expires_in),
            createdByUserId: input.actorUserId,
            lastAuthorizedAt: new Date(),
        })
        await appGitHubUserAuthSessionRepository.updateStatus(session.stateHash, 'completed')
        await auditRepository.appendEvent({
            actorUserId: input.actorUserId,
            roomId: null,
            action: 'github_user.connected',
            payload: {
                appId: app.appId,
                slug: app.slug,
                login: saved.login,
                githubUserId: saved.githubUserId,
            },
        })
        try {
            await refreshGitHubInstallations(input.actorUserId)
        } catch (error) {
            await auditRepository.appendEvent({
                actorUserId: input.actorUserId,
                roomId: null,
                action: 'github_installations.user_connect_sync_failed',
                payload: {
                    appId: app.appId,
                    slug: app.slug,
                    login: saved.login,
                    message: describeError(error),
                    status: error instanceof GitHubRequestError ? error.status : null,
                },
            })
        }
        return getGitHubIntegrationSummary()
    } catch (error) {
        await appGitHubUserAuthSessionRepository.updateStatusIfCurrent({
            stateHash: session.stateHash,
            currentStatus: 'pending',
            nextStatus: 'failed',
        })
        throw error
    }
}

function installationStatus(value: Record<string, unknown>): 'ready' | 'invalid' {
    return value.suspended_at ? 'invalid' : 'ready'
}

export async function refreshGitHubInstallations(
    actorUserId: string,
): Promise<GitHubIntegrationSummary> {
    const token = await appJwt()
    const installations: unknown[] = []
    for (let page = 1; page <= 10; page += 1) {
        const payload = await githubRequest<unknown[]>({
            method: 'GET',
            path: `/app/installations?per_page=100&page=${page}`,
            token,
        })
        installations.push(...payload)
        if (payload.length < 100) break
    }
    const syncedAt = new Date()
    let count = 0
    const activeInstallationIds: string[] = []
    for (const entry of installations) {
        if (!isRecord(entry)) continue
        const account = isRecord(entry.account) ? entry.account : {}
        const installationId = String(entry.id ?? '')
        const accountLogin = typeof account.login === 'string' ? account.login : ''
        if (!installationId || !accountLogin) continue
        activeInstallationIds.push(installationId)
        await appGitHubInstallationRepository.upsert({
            installationId,
            accountLogin,
            accountType: typeof account.type === 'string' ? account.type : 'Unknown',
            targetType: typeof entry.target_type === 'string' ? entry.target_type : null,
            htmlUrl: typeof entry.html_url === 'string' ? entry.html_url : null,
            repositorySelection:
                typeof entry.repository_selection === 'string'
                    ? entry.repository_selection
                    : 'selected',
            permissions: isRecord(entry.permissions) ? (entry.permissions as JsonValue) : {},
            suspendedAt:
                typeof entry.suspended_at === 'string' ? new Date(entry.suspended_at) : null,
            status: installationStatus(entry),
            lastSyncedAt: syncedAt,
        })
        count += 1
    }
    const invalidatedCount = await appGitHubInstallationRepository.markMissingInvalid({
        activeInstallationIds,
        lastSyncedAt: syncedAt,
    })

    await auditRepository.appendEvent({
        actorUserId,
        roomId: null,
        action: 'github_installations.synced',
        payload: {
            count,
            invalidatedCount,
        },
    })
    return getGitHubIntegrationSummary()
}

export async function createGitHubInstallationToken(input: {
    installationId: string
    repositories?: string[]
}): Promise<InstallationToken> {
    const token = await appJwt()
    const installation = await appGitHubInstallationRepository.findById(input.installationId)
    if (!installation) {
        throw new Error('GitHub installation is not known. Refresh GitHub installations first.')
    }
    if (installation.status !== 'ready') {
        throw new Error(
            `GitHub installation ${installation.accountLogin} is ${installation.status}`,
        )
    }
    const repositories = input.repositories?.length
        ? repositoryNamesForInstallation({
              accountLogin: installation.accountLogin,
              repositories: normalizeRepositories(input.repositories),
          })
        : undefined
    const payload = await githubRequest<Record<string, unknown>>({
        method: 'POST',
        path: `/app/installations/${encodeURIComponent(input.installationId)}/access_tokens`,
        token,
        body: {
            permissions: installationTokenPermissions,
            ...(repositories ? { repositories } : {}),
        },
    })
    const installationToken = typeof payload.token === 'string' ? payload.token : ''
    const expiresAt = typeof payload.expires_at === 'string' ? payload.expires_at : ''
    if (!installationToken || !expiresAt) {
        throw new Error('GitHub did not return an installation token')
    }
    return {
        token: installationToken,
        expiresAt,
    }
}

export async function listGitHubInstallationRepositories(input: {
    installationId: string
    query?: string | null
    page?: number
    pageSize?: number
}): Promise<{
    repositories: GitHubRepositorySummary[]
    totalCount: number
    scannedCount: number
    hasMore: boolean
    nextPage: number | null
    query: string
}> {
    const installationToken = await createGitHubInstallationToken({
        installationId: input.installationId,
    })
    const query = input.query?.trim().toLowerCase() ?? ''
    const page = Math.max(1, input.page ?? 1)
    const pageSize = Math.min(50, Math.max(5, input.pageSize ?? 25))
    const repositories: GitHubRepositorySummary[] = []
    let totalCount = 0
    let scannedCount = 0
    let hasMore = false
    let nextPage: number | null = null
    const offset = (page - 1) * pageSize
    const firstGitHubPage = query ? 1 : Math.floor(offset / 100) + 1
    const localOffset = query ? 0 : offset - (firstGitHubPage - 1) * 100
    const maxPagesToScan = query ? 50 : firstGitHubPage + 1
    for (let currentPage = firstGitHubPage; currentPage <= maxPagesToScan; currentPage += 1) {
        const payload = await githubRequest<Record<string, unknown>>({
            method: 'GET',
            path: `/installation/repositories?per_page=100&page=${currentPage}`,
            token: installationToken.token,
        })
        totalCount = typeof payload.total_count === 'number' ? payload.total_count : totalCount
        const items = Array.isArray(payload.repositories) ? payload.repositories : []
        for (const item of items) {
            if (!isRecord(item)) continue
            scannedCount += 1
            const id = String(item.id ?? '')
            const fullName = typeof item.full_name === 'string' ? item.full_name : ''
            if (!id || !fullName) continue
            if (query && !fullName.toLowerCase().includes(query)) continue
            repositories.push({
                id,
                fullName,
                private: item.private === true,
                defaultBranch: typeof item.default_branch === 'string' ? item.default_branch : null,
            })
        }
        if (!query) {
            if (repositories.length >= localOffset + pageSize || items.length < 100) {
                break
            }
        }
        if (items.length < 100) break
    }
    const sorted = repositories.sort((left, right) => left.fullName.localeCompare(right.fullName))
    const visible = query
        ? sorted.slice(0, pageSize)
        : sorted.slice(localOffset, localOffset + pageSize)
    if (!query) {
        hasMore = offset + pageSize < totalCount
        nextPage = hasMore ? page + 1 : null
    }
    if (query) {
        hasMore = sorted.length > pageSize || scannedCount < totalCount
        nextPage = null
    }
    return {
        repositories: visible,
        totalCount,
        scannedCount,
        hasMore,
        nextPage,
        query,
    }
}

export function summarizeRoomGitHubBinding(
    binding: RoomGitHubBindingRecord | null,
): GitHubRoomBindingSummary {
    return {
        enabled: binding?.enabled ?? false,
        installationId: binding?.installationId ?? null,
        repositories: binding ? normalizeRepositories(toStringArray(binding.repositories)) : [],
    }
}

export async function saveRoomGitHubBinding(input: {
    roomId: string
    roomMode: 'programmer' | 'coworker'
    enabled: boolean
    installationId?: string | null
    repositories: string[]
    actorUserId: string
}): Promise<GitHubRoomBindingSummary> {
    if (!input.enabled || input.roomMode !== 'programmer') {
        await roomGitHubBindingRepository.deleteByRoomId(input.roomId)
        return summarizeRoomGitHubBinding(null)
    }

    const installationId = input.installationId?.trim() ?? ''
    if (!installationId) {
        throw new Error('GitHub installation is required when GitHub is enabled')
    }
    const installation = await appGitHubInstallationRepository.findById(installationId)
    if (!installation) {
        throw new Error('Selected GitHub installation does not exist')
    }
    if (installation.status !== 'ready') {
        throw new Error(`Selected GitHub installation is ${installation.status}`)
    }
    const repositories = normalizeRepositories(input.repositories)
    if (repositories.length === 0) {
        throw new Error('Select at least one GitHub repository for this room')
    }
    repositoryNamesForInstallation({
        accountLogin: installation.accountLogin,
        repositories,
    })

    const binding = await roomGitHubBindingRepository.upsert({
        roomId: input.roomId,
        installationId,
        repositories,
        enabled: true,
        createdByUserId: input.actorUserId,
    })
    await auditRepository.appendEvent({
        actorUserId: input.actorUserId,
        roomId: input.roomId,
        action: 'room_github_binding.saved',
        payload: {
            installationId,
            repositoryCount: repositories.length,
        },
    })
    return summarizeRoomGitHubBinding(binding)
}

export async function resolveRoomGitHubStatus(input: {
    roomMode: 'programmer' | 'coworker'
    binding: RoomGitHubBindingRecord | null
}): Promise<{
    ready: boolean
    enabled: boolean
    installationId: string | null
    accountLogin: string | null
    repositories: string[]
    message: string | null
}> {
    if (!input.binding?.enabled || input.roomMode !== 'programmer') {
        return {
            ready: true,
            enabled: false,
            installationId: null,
            accountLogin: null,
            repositories: [],
            message: null,
        }
    }
    const repositories = normalizeRepositories(toStringArray(input.binding.repositories))
    const installation = await appGitHubInstallationRepository.findById(
        input.binding.installationId,
    )
    if (!installation) {
        return {
            ready: false,
            enabled: true,
            installationId: input.binding.installationId,
            accountLogin: null,
            repositories,
            message: 'GitHub installation is missing',
        }
    }
    if (installation.status !== 'ready') {
        return {
            ready: false,
            enabled: true,
            installationId: installation.installationId,
            accountLogin: installation.accountLogin,
            repositories,
            message: `GitHub installation ${installation.accountLogin} is ${installation.status}`,
        }
    }
    if (repositories.length === 0) {
        return {
            ready: false,
            enabled: true,
            installationId: installation.installationId,
            accountLogin: installation.accountLogin,
            repositories,
            message: 'GitHub binding has no repositories',
        }
    }
    return {
        ready: true,
        enabled: true,
        installationId: installation.installationId,
        accountLogin: installation.accountLogin,
        repositories,
        message: null,
    }
}

export async function materializeRoomGitHubBinding(input: {
    roomMode: 'programmer' | 'coworker'
    binding: RoomGitHubBindingRecord | null
}): Promise<{
    internalEnv: Record<string, string>
    github: MaterializedGitHubBinding
}> {
    const disabled = {
        internalEnv: {},
        github: {
            enabled: false,
            installationId: null,
            accountLogin: null,
            repositories: [],
            tokenEnvKey: null,
            tokenExpiresAt: null,
            ghHostsPath: null,
            gitCredentialsPath: null,
            gitConfigPath: null,
        },
    }
    if (!input.binding?.enabled || input.roomMode !== 'programmer') {
        return disabled
    }
    const status = await resolveRoomGitHubStatus({
        roomMode: input.roomMode,
        binding: input.binding,
    })
    if (!status.ready || !status.installationId || !status.accountLogin) {
        throw new Error(status.message ?? 'GitHub binding is not ready')
    }
    const installationToken = await createGitHubInstallationToken({
        installationId: status.installationId,
        repositories: status.repositories,
    })
    return {
        internalEnv: {
            [githubTokenEnvKey]: installationToken.token,
        },
        github: {
            enabled: true,
            installationId: status.installationId,
            accountLogin: status.accountLogin,
            repositories: status.repositories,
            tokenEnvKey: githubTokenEnvKey,
            tokenExpiresAt: installationToken.expiresAt,
            ghHostsPath: null,
            gitCredentialsPath: null,
            gitConfigPath: null,
        },
    }
}
