import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { hostedSecretNames } from '../src/server/cloudflare/hosted-config-contract'

async function putSecret(name: (typeof hostedSecretNames)[number], value: string): Promise<void> {
    const subprocess = spawn(
        'bun',
        ['x', 'wrangler', 'secret', 'put', name, '--config', 'wrangler.hosted.jsonc'],
        {
            cwd: fileURLToPath(new URL('..', import.meta.url)),
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
    for (const name of hostedSecretNames) {
        const value = process.env[name]
        if (!value) {
            throw new Error(`Missing required CI secret ${name}`)
        }
        await putSecret(name, value)
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
})
