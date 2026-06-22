import type { HostedResourceNames } from './cloudflare-hosted-config'
import {
    extractHostedResourceNames,
    readTargetedHostedConfigText,
    runWranglerResult,
} from './cloudflare-hosted-config'

interface DeleteOptions {
    missingPattern: RegExp
    toleratedFailurePattern?: RegExp
    toleratedFailureMessage?: string
}

interface DeleteStep {
    args: string[]
    label: string
    options: DeleteOptions
}

function assertPreviewResourceNames(resourceNames: HostedResourceNames): void {
    const values = [
        resourceNames.workerName,
        resourceNames.d1DatabaseName,
        resourceNames.r2BucketName,
        resourceNames.queueName,
    ]
    for (const value of values) {
        if (!/^agent-room-hosted-pr-[0-9]+(?:-[a-z0-9-]+)?$/.test(value)) {
            throw new Error(`Refusing to delete non-preview Cloudflare resource ${value}`)
        }
    }
}

export function buildPreviewDeleteSteps(resourceNames: HostedResourceNames): DeleteStep[] {
    return [
        {
            args: [
                'queues',
                'consumer',
                'remove',
                resourceNames.queueName,
                resourceNames.workerName,
            ],
            label: `${resourceNames.queueName} consumer ${resourceNames.workerName}`,
            options: {
                missingPattern: /does not exist|could not find|not found|no consumer/i,
            },
        },
        {
            args: ['delete', resourceNames.workerName, '--force'],
            label: resourceNames.workerName,
            options: {
                missingPattern: /does not exist|\[code: 10090\]/i,
            },
        },
        {
            args: ['d1', 'delete', resourceNames.d1DatabaseName, '--skip-confirmation'],
            label: resourceNames.d1DatabaseName,
            options: {
                missingPattern: /couldn't find db|does not exist/i,
            },
        },
        {
            args: ['queues', 'delete', resourceNames.queueName],
            label: resourceNames.queueName,
            options: {
                missingPattern: /does not exist/i,
            },
        },
        {
            args: ['r2', 'bucket', 'delete', resourceNames.r2BucketName],
            label: resourceNames.r2BucketName,
            options: {
                missingPattern: /specified bucket does not exist|\[code: 10006\]/i,
                toleratedFailurePattern: /not empty|contains objects|must be empty/i,
                toleratedFailureMessage: `Cloudflare R2 bucket ${resourceNames.r2BucketName} was not deleted because it still contains preview data`,
            },
        },
    ]
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
    if (options.toleratedFailurePattern?.test(output)) {
        console.warn(options.toleratedFailureMessage ?? `${label} was not deleted`)
        return
    }

    writeOutput(result.stdout)
    writeOutput(result.stderr)
    throw new Error(`Wrangler command failed: wrangler ${args.join(' ')}`)
}

function writeOutput(output: string): void {
    if (output.trim()) {
        process.stdout.write(output)
    }
}

async function main(): Promise<void> {
    const configText = await readTargetedHostedConfigText()
    const resourceNames = extractHostedResourceNames(configText)
    assertPreviewResourceNames(resourceNames)

    for (const step of buildPreviewDeleteSteps(resourceNames)) {
        await deleteResource(step.args, step.label, step.options)
    }
}

if (import.meta.main) {
    main().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error))
        process.exit(1)
    })
}
