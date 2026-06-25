import { appendFile } from 'node:fs/promises'

export interface HostedPreviewNames {
    prNumber: string
    workerName: string
    d1DatabaseName: string
    r2BucketName: string
    queueName: string
    url: string
}

export interface HostedPreviewTarget extends HostedPreviewNames {
    headSha: string
}

interface HostedPreviewTargetInput {
    prNumber: string
    workersSubdomain: string
    repository: string
    pullRequest: unknown
}

interface GitHubOutputValue {
    key: string
    value: string
}

export function buildHostedPreviewNames(
    prNumberInput: string,
    workersSubdomainInput: string,
): HostedPreviewNames {
    const prNumber = normalizePreviewPrNumber(prNumberInput)
    const workersSubdomain = normalizeWorkersSubdomain(workersSubdomainInput)
    const workerName = `agent-room-hosted-pr-${prNumber}`

    return {
        prNumber,
        workerName,
        d1DatabaseName: workerName,
        r2BucketName: `${workerName}-workspaces`,
        queueName: `${workerName}-runtime-jobs`,
        url: `https://${workerName}.${workersSubdomain}.workers.dev`,
    }
}

export function resolveHostedPreviewTarget(input: HostedPreviewTargetInput): HostedPreviewTarget {
    const names = buildHostedPreviewNames(input.prNumber, input.workersSubdomain)
    const pullRequest = objectRecord(input.pullRequest, 'GitHub pull request')
    const state = stringField(pullRequest, 'state', 'GitHub pull request state')
    if (state !== 'open') {
        throw new Error(`Preview deployment requires an open pull request, received ${state}`)
    }

    const head = objectField(pullRequest, 'head', 'GitHub pull request head')
    const headRepo = objectField(head, 'repo', 'GitHub pull request head repository')
    const headRepository = stringField(headRepo, 'full_name', 'GitHub pull request head repository')
    if (headRepository !== input.repository) {
        throw new Error('Preview deployment refuses pull requests from forks')
    }

    const headSha = stringField(head, 'sha', 'GitHub pull request head SHA')
    if (!/^[a-f0-9]{40}$/i.test(headSha)) {
        throw new Error('Preview deployment received an invalid pull request head SHA')
    }

    return {
        ...names,
        headSha,
    }
}

function normalizePreviewPrNumber(value: string): string {
    const trimmed = value.trim()
    if (!/^[1-9][0-9]*$/.test(trimmed)) {
        throw new Error('Preview PR number must be a positive integer')
    }
    return trimmed
}

function normalizeWorkersSubdomain(value: string): string {
    const trimmed = value.trim()
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(trimmed)) {
        throw new Error('CLOUDFLARE_WORKERS_SUBDOMAIN must be a workers.dev account subdomain')
    }
    return trimmed
}

async function readPullRequest(input: {
    apiUrl: string
    repository: string
    prNumber: string
    token: string
}): Promise<unknown> {
    const [owner, repo] = splitRepository(input.repository)
    const apiUrl = input.apiUrl.replace(/\/+$/, '')
    const response = await fetch(
        `${apiUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${encodeURIComponent(input.prNumber)}`,
        {
            headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${input.token}`,
                'X-GitHub-Api-Version': '2022-11-28',
            },
        },
    )
    if (!response.ok) {
        throw new Error(`GitHub pull request lookup failed with HTTP ${response.status}`)
    }
    return response.json()
}

function splitRepository(repository: string): [string, string] {
    const parts = repository.split('/')
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw new Error('GITHUB_REPOSITORY must be owner/repo')
    }
    return [parts[0], parts[1]]
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${label} must be an object`)
    }
    return value as Record<string, unknown>
}

function objectField(
    record: Record<string, unknown>,
    field: string,
    label: string,
): Record<string, unknown> {
    return objectRecord(record[field], label)
}

function stringField(record: Record<string, unknown>, field: string, label: string): string {
    const value = record[field]
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${label} must be a non-empty string`)
    }
    return value.trim()
}

function readRequiredEnvironmentValue(name: string): string {
    const value = process.env[name]?.trim()
    if (!value) {
        throw new Error(`${name} is required`)
    }
    return value
}

async function writeGitHubOutputs(
    outputPath: string | undefined,
    target: HostedPreviewTarget,
): Promise<void> {
    const values: GitHubOutputValue[] = [
        {
            key: 'pr_number',
            value: target.prNumber,
        },
        {
            key: 'head_sha',
            value: target.headSha,
        },
        {
            key: 'worker_name',
            value: target.workerName,
        },
        {
            key: 'd1_database_name',
            value: target.d1DatabaseName,
        },
        {
            key: 'r2_bucket_name',
            value: target.r2BucketName,
        },
        {
            key: 'queue_name',
            value: target.queueName,
        },
        {
            key: 'url',
            value: target.url,
        },
    ]
    const text = `${values.map((entry) => `${entry.key}=${entry.value}`).join('\n')}\n`
    if (outputPath) {
        await appendFile(outputPath, text)
        return
    }
    process.stdout.write(text)
}

async function main(): Promise<void> {
    const prNumber = readRequiredEnvironmentValue('PREVIEW_PR_NUMBER')
    const workersSubdomain = readRequiredEnvironmentValue('CLOUDFLARE_WORKERS_SUBDOMAIN')
    const repository = readRequiredEnvironmentValue('GITHUB_REPOSITORY')
    const token = readRequiredEnvironmentValue('GITHUB_TOKEN')
    const apiUrl = process.env.GITHUB_API_URL?.trim() || 'https://api.github.com'
    const pullRequest = await readPullRequest({
        apiUrl,
        repository,
        prNumber: normalizePreviewPrNumber(prNumber),
        token,
    })
    const target = resolveHostedPreviewTarget({
        prNumber,
        workersSubdomain,
        repository,
        pullRequest,
    })
    await writeGitHubOutputs(process.env.GITHUB_OUTPUT, target)
}

if (import.meta.main) {
    main().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error))
        process.exit(1)
    })
}
