import {
    createResolvedHostedConfig,
    runWrangler,
    writeHostedSecretsFile,
} from './cloudflare-hosted-config'

async function main(): Promise<void> {
    const config = await createResolvedHostedConfig()
    try {
        const secrets = await writeHostedSecretsFile()
        try {
            await runWrangler(['deploy', '--config', config.path, '--secrets-file', secrets.path])
        } finally {
            await secrets.cleanup()
        }
    } finally {
        await config.cleanup()
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
})
