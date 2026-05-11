import { randomBytes } from 'node:crypto'
import type {
    AppGitHubAppRecord,
    AppGitHubInstallationRecord,
    JsonValue,
    MaterializedGitHubBinding,
    RoomGitHubBindingRecord,
} from '../domain/types'
import {
    appGitHubAppRepository,
    appGitHubInstallationRepository,
    appGitHubManifestSessionRepository,
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
    GitHubInstallationSummary,
    GitHubIntegrationSummary,
    GitHubRepositorySummary,
    GitHubRoomBindingSummary,
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

interface InstallationToken {
    token: string
    expiresAt: string
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
        throw new Error(message)
    }
    return payload as T
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
        installUrl: `${githubWebBase}/apps/${app.slug}/installations/new`,
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

export async function getGitHubIntegrationSummary(): Promise<GitHubIntegrationSummary> {
    const [app, installations] = await Promise.all([
        appGitHubAppRepository.get(),
        appGitHubInstallationRepository.list(),
    ])
    return {
        app: summarizeGitHubApp(app),
        installations: installations.map(summarizeInstallation),
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
        public: false,
        default_permissions: installationTokenPermissions,
        default_events: [],
        request_oauth_on_install: false,
        setup_on_update: true,
    }
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

export async function completeGitHubAppManifest(input: {
    code: string
    state: string
    actorUserId: string
}): Promise<GitHubIntegrationSummary> {
    const session = await appGitHubManifestSessionRepository.findByStateHash(stateHash(input.state))
    if (!session || session.status !== 'pending') {
        throw new Error('GitHub App setup session was not found or is no longer active')
    }
    if (session.actorUserId !== input.actorUserId) {
        throw new Error('GitHub App setup session was started by another operator')
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
        await refreshGitHubInstallations(input.actorUserId)
        return getGitHubIntegrationSummary()
    } catch (error) {
        await appGitHubManifestSessionRepository.updateStatus(session.stateHash, 'failed')
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
}): Promise<GitHubRepositorySummary[]> {
    const installationToken = await createGitHubInstallationToken({
        installationId: input.installationId,
    })
    const repositories: GitHubRepositorySummary[] = []
    for (let page = 1; page <= 10; page += 1) {
        const payload = await githubRequest<Record<string, unknown>>({
            method: 'GET',
            path: `/installation/repositories?per_page=100&page=${page}`,
            token: installationToken.token,
        })
        const items = Array.isArray(payload.repositories) ? payload.repositories : []
        for (const item of items) {
            if (!isRecord(item)) continue
            const id = String(item.id ?? '')
            const fullName = typeof item.full_name === 'string' ? item.full_name : ''
            if (!id || !fullName) continue
            repositories.push({
                id,
                fullName,
                private: item.private === true,
                defaultBranch: typeof item.default_branch === 'string' ? item.default_branch : null,
            })
        }
        if (items.length < 100) break
    }
    return repositories.sort((left, right) => left.fullName.localeCompare(right.fullName))
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
    env: Record<string, string>
    github: MaterializedGitHubBinding
}> {
    const disabled = {
        env: {},
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
        env: {
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
