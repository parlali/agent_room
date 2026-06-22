import {
    extractHostedResourceNames,
    parseD1Databases,
    readTargetedHostedConfigText,
    readWrangler,
    runWranglerResult,
} from './cloudflare-hosted-config'

async function ensureD1Database(databaseName: string): Promise<void> {
    const databases = parseD1Databases(JSON.parse(await readWrangler(['d1', 'list', '--json'])))
    if (databases.some((database) => database.name === databaseName)) {
        console.log(`Cloudflare D1 database ${databaseName} already exists`)
        return
    }
    await runWranglerAcceptingFailure(
        ['d1', 'create', databaseName],
        `Cloudflare D1 database ${databaseName}`,
        /database with that name already exists/i,
    )
}

async function ensureR2Bucket(bucketName: string): Promise<void> {
    await runWranglerAcceptingFailure(
        ['r2', 'bucket', 'create', bucketName],
        `Cloudflare R2 bucket ${bucketName}`,
        /already exists, and you own it|\[code: 10004\]/i,
    )
}

async function ensureQueue(queueName: string): Promise<void> {
    await runWranglerAcceptingFailure(
        ['queues', 'create', queueName],
        `Cloudflare Queue ${queueName}`,
        /already taken|\[code: 11009\]/i,
    )
}

async function runWranglerAcceptingFailure(
    args: string[],
    label: string,
    allowedFailure: RegExp,
): Promise<void> {
    const result = await runWranglerResult(args)
    if (result.exitCode === 0) {
        writeOutput(result.stdout)
        writeOutput(result.stderr)
        return
    }

    const output = `${result.stdout}\n${result.stderr}`
    if (allowedFailure.test(output)) {
        console.log(`${label} already exists`)
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
    await ensureD1Database(resourceNames.d1DatabaseName)
    await ensureR2Bucket(resourceNames.r2BucketName)
    await ensureQueue(resourceNames.queueName)
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
})
