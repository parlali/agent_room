import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
    type HostedSecretName,
    hostedOptionalSecretNames,
    hostedRequiredSecretNames,
} from '../src/server/cloudflare/hosted-config-contract'

export const selfHostedDirectory = fileURLToPath(new URL('..', import.meta.url))
export const hostedConfigPath = join(selfHostedDirectory, 'wrangler.hosted.jsonc')

interface ResolvedHostedConfig {
    path: string
    databaseName: string
    cleanup: () => Promise<void>
}

interface HostedSecretsFile {
    path: string
    cleanup: () => Promise<void>
}

interface D1DatabaseRow {
    uuid: string
    name: string
}

interface CommandOptions {
    input?: string
}

export async function runWrangler(args: string[], options: CommandOptions = {}): Promise<void> {
    const subprocess = spawn('bun', ['x', 'wrangler', ...args], {
        cwd: selfHostedDirectory,
        stdio: [options.input ? 'pipe' : 'ignore', 'inherit', 'inherit'],
    })

    if (options.input) {
        const stdin = subprocess.stdin
        if (!stdin) {
            throw new Error('Wrangler subprocess stdin was not available')
        }
        stdin.write(options.input)
        stdin.end()
    }

    const exitCode = await waitForSubprocess(subprocess)
    if (exitCode !== 0) {
        throw new Error(`Wrangler command failed: wrangler ${args.join(' ')}`)
    }
}

export async function readWrangler(args: string[]): Promise<string> {
    const subprocess = spawn('bun', ['x', 'wrangler', ...args], {
        cwd: selfHostedDirectory,
        stdio: ['ignore', 'pipe', 'inherit'],
    })
    const chunks: Buffer[] = []
    subprocess.stdout.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
    })

    const exitCode = await waitForSubprocess(subprocess)
    if (exitCode !== 0) {
        throw new Error(`Wrangler command failed: wrangler ${args.join(' ')}`)
    }
    return Buffer.concat(chunks).toString('utf8')
}

export async function createResolvedHostedConfig(): Promise<ResolvedHostedConfig> {
    const configText = await readFile(hostedConfigPath, 'utf8')
    const databaseName = extractHostedD1DatabaseName(configText)
    const databaseId = await resolveD1DatabaseId(databaseName)
    const resolvedConfigText = addD1DatabaseId(configText, databaseName, databaseId)
    const path = join(
        selfHostedDirectory,
        `.wrangler.hosted.resolved.${process.pid}.${Date.now()}.jsonc`,
    )
    await writeFile(path, resolvedConfigText)

    return {
        path,
        databaseName,
        cleanup: () => rm(path, { force: true }),
    }
}

export function readHostedSecretsFromEnvironment(): Map<HostedSecretName, string> {
    const secrets = new Map<HostedSecretName, string>()
    for (const name of hostedRequiredSecretNames) {
        const value = process.env[name]
        if (!value) {
            throw new Error(`Missing required CI secret ${name}`)
        }
        secrets.set(name, value)
    }
    for (const name of hostedOptionalSecretNames) {
        const value = process.env[name]
        if (value) {
            secrets.set(name, value)
        }
    }
    return secrets
}

export async function writeHostedSecretsFile(): Promise<HostedSecretsFile> {
    const directory = await mkdtemp(join(tmpdir(), 'agent-room-hosted-secrets-'))
    const path = join(directory, 'secrets.json')
    const secrets = Object.fromEntries(readHostedSecretsFromEnvironment())
    await writeFile(path, JSON.stringify(secrets, null, 4), { mode: 0o600 })
    return {
        path,
        cleanup: () => rm(directory, { recursive: true, force: true }),
    }
}

function waitForSubprocess(subprocess: ReturnType<typeof spawn>): Promise<number> {
    return new Promise((resolve, reject) => {
        subprocess.once('error', reject)
        subprocess.once('close', (code) => {
            resolve(code ?? 1)
        })
    })
}

function extractHostedD1DatabaseName(configText: string): string {
    const match = configText.match(/"database_name"\s*:\s*"([^"]+)"/)
    if (!match) {
        throw new Error('Hosted Wrangler config is missing a D1 database_name')
    }
    return match[1]
}

async function resolveD1DatabaseId(databaseName: string): Promise<string> {
    const configuredDatabaseId = process.env.CLOUDFLARE_D1_DATABASE_ID?.trim()
    if (configuredDatabaseId) {
        return configuredDatabaseId
    }

    const output = await readWrangler(['d1', 'list', '--json'])
    const databases = parseD1Databases(JSON.parse(output))
    const database = databases.find((row) => row.name === databaseName)
    if (!database) {
        throw new Error(
            `Missing remote D1 database ${databaseName}. Run bun x wrangler d1 create ${databaseName}`,
        )
    }
    return database.uuid
}

function parseD1Databases(value: unknown): D1DatabaseRow[] {
    if (!Array.isArray(value)) {
        throw new Error('Unexpected Wrangler D1 list response')
    }
    return value.map((row) => {
        if (!isD1DatabaseRow(row)) {
            throw new Error('Unexpected Wrangler D1 database row')
        }
        return row
    })
}

function isD1DatabaseRow(value: unknown): value is D1DatabaseRow {
    return (
        typeof value === 'object' &&
        value !== null &&
        'uuid' in value &&
        'name' in value &&
        typeof value.uuid === 'string' &&
        typeof value.name === 'string'
    )
}

function addD1DatabaseId(configText: string, databaseName: string, databaseId: string): string {
    const existingDatabaseIdPattern = /"database_id"\s*:\s*"[^"]*"/
    if (existingDatabaseIdPattern.test(configText)) {
        return configText.replace(existingDatabaseIdPattern, `"database_id": "${databaseId}"`)
    }

    const databaseNamePattern = new RegExp(
        `("database_name"\\s*:\\s*"${escapeRegExp(databaseName)}"\\s*,)`,
    )
    if (!databaseNamePattern.test(configText)) {
        throw new Error(`Hosted Wrangler config is missing D1 database ${databaseName}`)
    }
    return configText.replace(
        databaseNamePattern,
        `$1\n            "database_id": "${databaseId}",`,
    )
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
