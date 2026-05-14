import { createHash, createSign, randomBytes } from 'node:crypto'
import type { AppGitHubAppRecord, JsonValue } from '../domain/types'

export const githubApiBase = 'https://api.github.com'
export const githubWebBase = 'https://github.com'
export const githubApiVersion = '2022-11-28'
export const manifestTtlMs = 60 * 60 * 1000
export const githubTokenEnvKey = 'AGENT_ROOM_GITHUB_INSTALLATION_TOKEN'
export const installationTokenPermissions = {
    contents: 'write',
    issues: 'write',
    metadata: 'read',
    pull_requests: 'write',
} as const

export function stateHash(state: string): string {
    return createHash('sha256').update(state).digest('hex')
}

export function pkceChallenge(verifier: string): string {
    return createHash('sha256').update(verifier).digest('base64url')
}

function base64UrlJson(value: unknown): string {
    return Buffer.from(JSON.stringify(value)).toString('base64url')
}

export function normalizePublicOrigin(value: string): string {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('GitHub callback origin must use http or https')
    }
    return url.origin
}

export function normalizeOwner(value?: string | null): string | null {
    const owner = value?.trim().replace(/^@+/, '') ?? ''
    if (!owner) return null
    if (!/^[A-Za-z0-9-]+$/.test(owner)) {
        throw new Error('GitHub organization can only contain letters, numbers, and hyphens')
    }
    return owner
}

export function manifestAppName(publicOrigin: string): string {
    const host = new URL(publicOrigin).hostname
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 24)
    const suffix = randomBytes(4).toString('hex')
    return host ? `Agent Room ${host}-${suffix}` : `Agent Room ${suffix}`
}

export function createGithubJwt(app: AppGitHubAppRecord, privateKey: string): string {
    const now = Math.floor(Date.now() / 1000)
    const header = base64UrlJson({
        alg: 'RS256',
        typ: 'JWT',
    })
    const payload = base64UrlJson({
        iat: now - 60,
        exp: now + 9 * 60,
        iss: app.appId,
    })
    const sign = createSign('RSA-SHA256')
    sign.update(`${header}.${payload}`)
    sign.end()
    const signature = sign.sign(privateKey).toString('base64url')
    return `${header}.${payload}.${signature}`
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function toStringRecord(value: unknown): Record<string, string> {
    if (!isRecord(value)) return {}
    const output: Record<string, string> = {}
    for (const [key, entry] of Object.entries(value)) {
        if (typeof entry === 'string') {
            output[key] = entry
        }
    }
    return output
}

export function toStringArray(value: JsonValue): string[] {
    return Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
        : []
}

export function normalizeRepositories(repositories: string[]): string[] {
    return [
        ...new Set(
            repositories
                .map((repository) => repository.trim())
                .filter((repository) => repository.length > 0)
                .map((repository) => {
                    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
                        throw new Error(
                            `GitHub repository "${repository}" must be in owner/name form`,
                        )
                    }
                    return repository
                }),
        ),
    ].sort((left, right) => left.localeCompare(right))
}

export function repositoryNamesForInstallation(input: {
    accountLogin: string
    repositories: string[]
}): string[] {
    const owner = input.accountLogin.toLowerCase()
    return input.repositories.map((repository) => {
        const [repoOwner, repoName] = repository.split('/')
        if (!repoOwner || !repoName || repoOwner.toLowerCase() !== owner) {
            throw new Error(
                `Repository ${repository} is not under GitHub installation account ${input.accountLogin}`,
            )
        }
        return repoName
    })
}
