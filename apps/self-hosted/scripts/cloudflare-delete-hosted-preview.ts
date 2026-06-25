import type { HostedResourceNames } from './cloudflare-hosted-config'
import {
    extractHostedResourceNames,
    readTargetedHostedConfigText,
    runWranglerResult,
} from './cloudflare-hosted-config'

interface DeleteOptions {
    missingPattern: RegExp
}

interface WranglerDeleteStep {
    type: 'wrangler'
    args: string[]
    label: string
    options: DeleteOptions
}

interface WorkerScriptDeleteStep {
    type: 'worker-script'
    scriptName: string
    label: string
}

type DeleteStep = WranglerDeleteStep | WorkerScriptDeleteStep

function isPreviewResourceNames(resourceNames: HostedResourceNames): boolean {
    const values = [
        resourceNames.workerName,
        resourceNames.d1DatabaseName,
        resourceNames.r2BucketName,
        resourceNames.queueName,
    ]
    return values.every((value) => /^agent-room-hosted-pr-[0-9]+(?:-[a-z0-9-]+)?$/.test(value))
}

function isProductionResourceNames(resourceNames: HostedResourceNames): boolean {
    const expected: HostedResourceNames = {
        workerName: 'agent-room-hosted',
        d1DatabaseName: 'agent-room-hosted',
        r2BucketName: 'agent-room-hosted-workspaces',
        queueName: 'agent-room-hosted-runtime-jobs',
    }
    return Object.entries(resourceNames).every(
        ([key, value]) => value === expected[key as keyof HostedResourceNames],
    )
}

export function assertHostedResourceNamesDeletable(resourceNames: HostedResourceNames): void {
    if (isPreviewResourceNames(resourceNames)) {
        return
    }
    if (
        isProductionResourceNames(resourceNames) &&
        process.env.AGENT_ROOM_CLOUDFLARE_ALLOW_HOSTED_PRODUCTION_RESET === 'true'
    ) {
        return
    }
    throw new Error('Refusing to delete non-preview Cloudflare resources without reset guard')
}

export function buildPreviewDeleteSteps(resourceNames: HostedResourceNames): DeleteStep[] {
    return [
        {
            type: 'wrangler',
            args: [
                'queues',
                'consumer',
                'remove',
                resourceNames.queueName,
                resourceNames.workerName,
            ],
            label: `${resourceNames.queueName} consumer ${resourceNames.workerName}`,
            options: {
                missingPattern:
                    /does not exist|could not find|not found|no consumer|no worker consumer/i,
            },
        },
        {
            type: 'worker-script',
            scriptName: resourceNames.workerName,
            label: resourceNames.workerName,
        },
        {
            type: 'wrangler',
            args: ['d1', 'delete', resourceNames.d1DatabaseName, '--skip-confirmation'],
            label: resourceNames.d1DatabaseName,
            options: {
                missingPattern: /couldn't find db|does not exist/i,
            },
        },
        {
            type: 'wrangler',
            args: ['queues', 'delete', resourceNames.queueName],
            label: resourceNames.queueName,
            options: {
                missingPattern: /does not exist/i,
            },
        },
        {
            type: 'wrangler',
            args: ['r2', 'bucket', 'delete', resourceNames.r2BucketName],
            label: resourceNames.r2BucketName,
            options: {
                missingPattern: /specified bucket does not exist|\[code: 10006\]/i,
            },
        },
    ]
}

interface CloudflareApiCredentials {
    accountId: string
    apiToken: string
}

interface CloudflareApiError {
    code?: number | string
    message?: string
}

interface CloudflareApiResponse {
    success?: boolean
    errors?: CloudflareApiError[]
}

async function deleteResource(
    args: string[],
    label: string,
    options: DeleteOptions,
): Promise<void> {
    const result = await runWranglerResult(args)
    if (result.exitCode === 0) {
        writeOutput(result.stdout)
        writeOutput(result.stderr)
        return
    }

    const output = `${result.stdout}\n${result.stderr}`
    if (options.missingPattern.test(output)) {
        console.log(`${label} does not exist`)
        return
    }

    writeOutput(result.stdout)
    writeOutput(result.stderr)
    throw new Error(`Wrangler command failed: wrangler ${args.join(' ')}`)
}

async function deleteStep(step: DeleteStep): Promise<void> {
    if (step.type === 'worker-script') {
        await deleteWorkerScript(step.scriptName, step.label)
        return
    }
    await deleteResource(step.args, step.label, step.options)
}

async function deleteWorkerScript(scriptName: string, label: string): Promise<void> {
    const credentials = readCloudflareApiCredentials()
    if (!credentials) {
        await deleteResource(['delete', scriptName, '--force'], label, {
            missingPattern: /does not exist|\[code: 10090\]/i,
        })
        return
    }

    const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(credentials.accountId)}/workers/scripts/${encodeURIComponent(scriptName)}`,
        {
            method: 'DELETE',
            headers: {
                Authorization: `Bearer ${credentials.apiToken}`,
            },
        },
    )
    const bodyText = await response.text()
    const body = parseCloudflareApiResponse(bodyText)
    if (response.ok && body?.success !== false) {
        console.log(`Deleted ${label}`)
        return
    }
    if (response.status === 404 || hasCloudflareErrorCode(body, '10007')) {
        console.log(`${label} does not exist`)
        return
    }

    throw new Error(
        `Cloudflare API failed to delete ${label}: ${summarizeCloudflareApiError(response, body)}`,
    )
}

function readCloudflareApiCredentials(): CloudflareApiCredentials | null {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim()
    const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim()
    if (!accountId && !apiToken) {
        return null
    }
    if (!accountId || !apiToken) {
        throw new Error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must both be set')
    }
    return {
        accountId,
        apiToken,
    }
}

function parseCloudflareApiResponse(bodyText: string): CloudflareApiResponse | null {
    if (!bodyText.trim()) {
        return null
    }
    try {
        return JSON.parse(bodyText) as CloudflareApiResponse
    } catch {
        return null
    }
}

function hasCloudflareErrorCode(body: CloudflareApiResponse | null, code: string): boolean {
    return body?.errors?.some((error) => String(error.code) === code) ?? false
}

function summarizeCloudflareApiError(
    response: Response,
    body: CloudflareApiResponse | null,
): string {
    const errors = body?.errors
        ?.map((error) => [error.code, error.message].filter(Boolean).join(' '))
        .filter(Boolean)
    if (errors?.length) {
        return errors.join('; ')
    }
    return `HTTP ${response.status}`
}

function writeOutput(output: string): void {
    if (output.trim()) {
        process.stdout.write(output)
    }
}

async function main(): Promise<void> {
    const configText = await readTargetedHostedConfigText()
    const resourceNames = extractHostedResourceNames(configText)
    assertHostedResourceNamesDeletable(resourceNames)

    for (const step of buildPreviewDeleteSteps(resourceNames)) {
        await deleteStep(step)
    }
}

if (import.meta.main) {
    main().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error))
        process.exit(1)
    })
}
