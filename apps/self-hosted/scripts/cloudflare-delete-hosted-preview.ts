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

    await deleteResource(
        ['delete', resourceNames.workerName, '--force'],
        resourceNames.workerName,
        {
            missingPattern: /does not exist|\[code: 10090\]/i,
        },
    )
    await deleteResource(
        ['d1', 'delete', resourceNames.d1DatabaseName, '--skip-confirmation'],
        resourceNames.d1DatabaseName,
        {
            missingPattern: /couldn't find db|does not exist/i,
        },
    )
    await deleteResource(['queues', 'delete', resourceNames.queueName], resourceNames.queueName, {
        missingPattern: /does not exist/i,
    })
    await deleteResource(
        ['r2', 'bucket', 'delete', resourceNames.r2BucketName],
        resourceNames.r2BucketName,
        {
            missingPattern: /specified bucket does not exist|\[code: 10006\]/i,
            toleratedFailurePattern: /not empty|contains objects|must be empty/i,
            toleratedFailureMessage: `Cloudflare R2 bucket ${resourceNames.r2BucketName} was not deleted because it still contains preview data`,
        },
    )
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
})
