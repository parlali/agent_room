import { spawn } from 'node:child_process'
import type { HostedSecretName } from '../src/server/cloudflare/hosted-config-contract'
import {
    hostedConfigPath,
    readHostedSecretsFromEnvironment,
    selfHostedDirectory,
} from './cloudflare-hosted-config'

async function putSecret(name: HostedSecretName, value: string): Promise<void> {
    const subprocess = spawn(
        'bun',
        ['x', 'wrangler', 'secret', 'put', name, '--config', hostedConfigPath],
        {
            cwd: selfHostedDirectory,
            stdio: ['pipe', 'inherit', 'inherit'],
        },
    )

    subprocess.stdin.write(value)
    subprocess.stdin.end()

    const exitCode = await new Promise<number>((resolve, reject) => {
        subprocess.once('error', reject)
        subprocess.once('close', (code) => {
            resolve(code ?? 1)
        })
    })
    if (exitCode !== 0) {
        throw new Error(`Failed to put Cloudflare secret ${name}`)
    }
}

async function main(): Promise<void> {
    for (const [name, value] of readHostedSecretsFromEnvironment()) {
        await putSecret(name, value)
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
})
