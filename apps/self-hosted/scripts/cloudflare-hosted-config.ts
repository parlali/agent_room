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
    resourceNames: HostedResourceNames
    cleanup: () => Promise<void>
}

interface HostedSecretsFile {
    path: string
    cleanup: () => Promise<void>
}

export interface HostedResourceNames {
    workerName: string
    d1DatabaseName: string
    r2BucketName: string
    queueName: string
}

export interface HostedDeploymentTarget {
    workerName?: string
    d1DatabaseName?: string
    r2BucketName?: string
    queueName?: string
    routePattern?: string | null
    workersDev?: boolean
    previewUrls?: boolean
}

export interface D1DatabaseRow {
    uuid: string
    name: string
}

interface CommandOptions {
    input?: string
}

export interface WranglerResult {
    exitCode: number
    stdout: string
    stderr: string
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

export async function runWranglerResult(
    args: string[],
    options: CommandOptions = {},
): Promise<WranglerResult> {
    const subprocess = spawn('bun', ['x', 'wrangler', ...args], {
        cwd: selfHostedDirectory,
        stdio: [options.input ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    if (!subprocess.stdout || !subprocess.stderr) {
        throw new Error('Wrangler subprocess output streams were not available')
    }

    subprocess.stdout.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk)
    })
    subprocess.stderr.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk)
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
    return {
        exitCode,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
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
    const configText = await readTargetedHostedConfigText()
    const resourceNames = extractHostedResourceNames(configText)
    const databaseName = resourceNames.d1DatabaseName
    const databaseId = await resolveD1DatabaseId(resourceNames.d1DatabaseName)
    const resolvedConfigText = addD1DatabaseId(configText, databaseName, databaseId)
    const path = join(
        selfHostedDirectory,
        `.wrangler.hosted.resolved.${process.pid}.${Date.now()}.jsonc`,
    )
    await writeFile(path, resolvedConfigText)

    return {
        path,
        databaseName,
        resourceNames,
        cleanup: () => rm(path, { force: true }),
    }
}

export async function readTargetedHostedConfigText(): Promise<string> {
    const configText = await readFile(hostedConfigPath, 'utf8')
    return applyHostedDeploymentTarget(configText, readHostedDeploymentTargetFromEnvironment())
}

export function readHostedDeploymentTargetFromEnvironment(): HostedDeploymentTarget {
    const routePattern = readOptionalEnvironmentValue('AGENT_ROOM_CLOUDFLARE_ROUTE_PATTERN')
    return removeUndefinedValues({
        workerName: readCloudflareNameEnvironmentValue('AGENT_ROOM_CLOUDFLARE_WORKER_NAME'),
        d1DatabaseName: readCloudflareNameEnvironmentValue(
            'AGENT_ROOM_CLOUDFLARE_D1_DATABASE_NAME',
        ),
        r2BucketName: readCloudflareNameEnvironmentValue('AGENT_ROOM_CLOUDFLARE_R2_BUCKET_NAME'),
        queueName: readCloudflareNameEnvironmentValue('AGENT_ROOM_CLOUDFLARE_QUEUE_NAME'),
        routePattern: routePattern === undefined ? undefined : routePattern || null,
        workersDev: readBooleanEnvironmentValue('AGENT_ROOM_CLOUDFLARE_WORKERS_DEV'),
        previewUrls: readBooleanEnvironmentValue('AGENT_ROOM_CLOUDFLARE_PREVIEW_URLS'),
    })
}

export function applyHostedDeploymentTarget(
    configText: string,
    target: HostedDeploymentTarget,
): string {
    let nextConfigText = configText
    if (target.workerName) {
        nextConfigText = replaceFirstStringProperty(nextConfigText, 'name', target.workerName)
    }
    if (target.d1DatabaseName) {
        nextConfigText = replaceEveryStringProperty(
            nextConfigText,
            'database_name',
            target.d1DatabaseName,
        )
    }
    if (target.r2BucketName) {
        nextConfigText = replaceEveryStringProperty(
            nextConfigText,
            'bucket_name',
            target.r2BucketName,
        )
    }
    if (target.queueName) {
        nextConfigText = replaceEveryStringProperty(nextConfigText, 'queue', target.queueName)
    }
    if (target.workersDev !== undefined) {
        nextConfigText = replaceBooleanProperty(nextConfigText, 'workers_dev', target.workersDev)
    }
    if (target.previewUrls !== undefined) {
        nextConfigText = replaceBooleanProperty(nextConfigText, 'preview_urls', target.previewUrls)
    }
    if (target.routePattern !== undefined) {
        nextConfigText = target.routePattern
            ? upsertRoutesProperty(nextConfigText, target.routePattern)
            : removeRoutesProperty(nextConfigText)
    }
    return nextConfigText
}

export function extractHostedResourceNames(configText: string): HostedResourceNames {
    const queueNames = Array.from(configText.matchAll(/"queue"\s*:\s*"([^"]+)"/g)).map(
        (match) => match[1],
    )
    const uniqueQueueNames = new Set(queueNames)
    if (uniqueQueueNames.size !== 1) {
        throw new Error('Hosted Wrangler config must use one canonical queue name')
    }

    return {
        workerName: extractFirstStringProperty(configText, 'name'),
        d1DatabaseName: extractFirstStringProperty(configText, 'database_name'),
        r2BucketName: extractFirstStringProperty(configText, 'bucket_name'),
        queueName: queueNames[0],
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

function extractFirstStringProperty(configText: string, propertyName: string): string {
    const match = new RegExp(`"${escapeRegExp(propertyName)}"\\s*:\\s*"([^"]+)"`).exec(configText)
    if (!match) {
        throw new Error(`Hosted Wrangler config is missing ${propertyName}`)
    }
    return match[1]
}

async function resolveD1DatabaseId(databaseName: string): Promise<string> {
    const configuredDatabaseId = process.env.CLOUDFLARE_D1_DATABASE_ID?.trim()
    const output = await readWrangler(['d1', 'list', '--json'])
    const databases = parseD1Databases(JSON.parse(output))
    return selectD1DatabaseId(databaseName, databases, configuredDatabaseId || undefined)
}

export function selectD1DatabaseId(
    databaseName: string,
    databases: D1DatabaseRow[],
    configuredDatabaseId?: string,
): string {
    if (configuredDatabaseId) {
        const database = databases.find((row) => row.uuid === configuredDatabaseId)
        if (!database || database.name !== databaseName) {
            throw new Error(
                `CLOUDFLARE_D1_DATABASE_ID does not match hosted database ${databaseName}`,
            )
        }
        console.log(`Using explicit CLOUDFLARE_D1_DATABASE_ID for ${databaseName}`)
        return configuredDatabaseId
    }

    const database = databases.find((row) => row.name === databaseName)
    if (!database) {
        throw new Error(
            `Missing remote D1 database ${databaseName}. Run bun x wrangler d1 create ${databaseName}`,
        )
    }
    return database.uuid
}

export function parseD1Databases(value: unknown): D1DatabaseRow[] {
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

function readOptionalEnvironmentValue(name: string): string | undefined {
    const value = process.env[name]
    return value === undefined ? undefined : value.trim()
}

function readCloudflareNameEnvironmentValue(name: string): string | undefined {
    const value = readOptionalEnvironmentValue(name)
    if (!value) {
        return undefined
    }
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(value)) {
        throw new Error(`${name} must use lowercase letters, numbers, and hyphens`)
    }
    return value
}

function readBooleanEnvironmentValue(name: string): boolean | undefined {
    const value = readOptionalEnvironmentValue(name)
    if (!value) {
        return undefined
    }
    if (['1', 'true', 'yes'].includes(value.toLowerCase())) {
        return true
    }
    if (['0', 'false', 'no'].includes(value.toLowerCase())) {
        return false
    }
    throw new Error(`${name} must be true or false`)
}

function removeUndefinedValues<T extends Record<string, unknown>>(value: T): T {
    return Object.fromEntries(Object.entries(value).filter((entry) => entry[1] !== undefined)) as T
}

function replaceFirstStringProperty(
    configText: string,
    propertyName: string,
    value: string,
): string {
    const pattern = new RegExp(`("${escapeRegExp(propertyName)}"\\s*:\\s*)"[^"]*"`)
    if (!pattern.test(configText)) {
        throw new Error(`Hosted Wrangler config is missing ${propertyName}`)
    }
    return configText.replace(pattern, `$1"${value}"`)
}

function replaceEveryStringProperty(
    configText: string,
    propertyName: string,
    value: string,
): string {
    const pattern = new RegExp(`("${escapeRegExp(propertyName)}"\\s*:\\s*)"[^"]*"`, 'g')
    if (!pattern.test(configText)) {
        throw new Error(`Hosted Wrangler config is missing ${propertyName}`)
    }
    return configText.replace(pattern, `$1"${value}"`)
}

function replaceBooleanProperty(configText: string, propertyName: string, value: boolean): string {
    const pattern = new RegExp(`("${escapeRegExp(propertyName)}"\\s*:\\s*)(true|false)`)
    if (!pattern.test(configText)) {
        throw new Error(`Hosted Wrangler config is missing ${propertyName}`)
    }
    return configText.replace(pattern, `$1${String(value)}`)
}

function upsertRoutesProperty(configText: string, routePattern: string): string {
    const withoutRoutes = removeRoutesProperty(configText)
    const varsIndex = withoutRoutes.indexOf('    "vars"')
    if (varsIndex < 0) {
        throw new Error('Hosted Wrangler config is missing vars')
    }
    const encodedRoutePattern = JSON.stringify(routePattern)
    const routesText = [
        '    "routes": [',
        '        {',
        `            "pattern": ${encodedRoutePattern},`,
        '            "custom_domain": true,',
        '        },',
        '    ],',
        '',
    ].join('\n')
    return `${withoutRoutes.slice(0, varsIndex)}${routesText}${withoutRoutes.slice(varsIndex)}`
}

function removeRoutesProperty(configText: string): string {
    const propertyIndex = configText.indexOf('"routes"')
    if (propertyIndex < 0) {
        return configText
    }
    const lineStart = configText.lastIndexOf('\n', propertyIndex)
    const arrayStart = configText.indexOf('[', propertyIndex)
    if (arrayStart < 0) {
        throw new Error('Hosted Wrangler routes config is malformed')
    }
    const arrayEnd = findMatchingArrayEnd(configText, arrayStart)
    let removalEnd = arrayEnd + 1
    if (configText[removalEnd] === ',') {
        removalEnd += 1
    }
    if (configText[removalEnd] === '\n') {
        removalEnd += 1
    }
    return `${configText.slice(0, lineStart + 1)}${configText.slice(removalEnd)}`
}

function findMatchingArrayEnd(configText: string, arrayStart: number): number {
    let depth = 0
    let insideString = false
    let escaped = false
    for (let index = arrayStart; index < configText.length; index += 1) {
        const character = configText[index]
        if (insideString) {
            if (escaped) {
                escaped = false
            } else if (character === '\\') {
                escaped = true
            } else if (character === '"') {
                insideString = false
            }
            continue
        }
        if (character === '"') {
            insideString = true
        } else if (character === '[') {
            depth += 1
        } else if (character === ']') {
            depth -= 1
            if (depth === 0) {
                return index
            }
        }
    }
    throw new Error('Hosted Wrangler routes config is malformed')
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
