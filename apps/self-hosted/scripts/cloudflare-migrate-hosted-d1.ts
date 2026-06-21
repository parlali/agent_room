import { createResolvedHostedConfig, runWrangler } from './cloudflare-hosted-config'

async function main(): Promise<void> {
    const config = await createResolvedHostedConfig()
    try {
        await runWrangler([
            'd1',
            'migrations',
            'apply',
            config.databaseName,
            '--remote',
            '--config',
            config.path,
        ])
    } finally {
        await config.cleanup()
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
})
