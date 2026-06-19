import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const requiredSecretNames = [
    'BETTER_AUTH_SECRET',
    'BETTER_AUTH_URL',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'AGENT_ROOM_EMAIL_WEBHOOK_URL',
    'AGENT_ROOM_EMAIL_WEBHOOK_BEARER_TOKEN',
    'AGENT_ROOM_EMAIL_FROM',
] as const

async function putSecret(name: (typeof requiredSecretNames)[number], value: string): Promise<void> {
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

    const exitCode = await new Promise<number | null>((resolve) => {
        subprocess.once('exit', resolve)
    })
    if (exitCode !== 0) {
        throw new Error(`Failed to put Cloudflare secret ${name}`)
    }
}

async function main(): Promise<void> {
    for (const name of requiredSecretNames) {
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
