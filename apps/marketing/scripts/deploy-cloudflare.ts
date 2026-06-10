import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type D1ListDatabase = {
    name?: unknown
    uuid?: unknown
}

const databaseName = 'agent-room-marketing-waitlist'
const databaseBinding = 'WAITLIST_DB'
const workerName = 'agent-room-marketing'
const compatibilityDate = '2026-06-10'
const migrationsDir = join(process.cwd(), 'apps/marketing/db/migrations')
const dryRun = process.argv.includes('--dry-run')
const migrateOnly = process.argv.includes('--migrate-only')

async function run(command: string[], options: { captureStdout?: boolean } = {}): Promise<string> {
    const subprocess = Bun.spawn(command, {
        stdout: options.captureStdout ? 'pipe' : 'inherit',
        stderr: 'inherit',
    })
    const output =
        options.captureStdout && subprocess.stdout
            ? await new Response(subprocess.stdout).text()
            : ''
    const exitCode = await subprocess.exited

    if (exitCode !== 0) {
        throw new Error(`Command failed with exit code ${exitCode}: ${command.join(' ')}`)
    }

    return output
}

function parseD1List(output: string): D1ListDatabase[] {
    const parsed = JSON.parse(output) as unknown

    if (!Array.isArray(parsed)) {
        throw new Error('Wrangler returned an unexpected D1 list payload.')
    }

    return parsed as D1ListDatabase[]
}

async function sleep(milliseconds: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function findD1DatabaseId(): Promise<string> {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
        const output = await run(['wrangler', 'd1', 'list', '--json'], { captureStdout: true })
        const database = parseD1List(output).find((entry) => entry.name === databaseName)

        if (typeof database?.uuid === 'string' && database.uuid) {
            return database.uuid
        }

        if (attempt < 5) {
            await sleep(2000)
        }
    }

    throw new Error(`Could not find D1 database "${databaseName}" after deployment.`)
}

async function writeTemporaryWranglerConfig(databaseId: string): Promise<{
    configPath: string
    directory: string
}> {
    const directory = await mkdtemp(join(tmpdir(), 'agent-room-marketing-wrangler-'))
    const configPath = join(directory, 'wrangler.jsonc')
    const config = {
        name: `${workerName}-d1-migrations`,
        compatibility_date: compatibilityDate,
        d1_databases: [
            {
                binding: databaseBinding,
                database_name: databaseName,
                database_id: databaseId,
                migrations_dir: migrationsDir,
            },
        ],
    }

    await writeFile(configPath, JSON.stringify(config, null, 4))

    return { configPath, directory }
}

async function applyRemoteMigrations(): Promise<void> {
    const databaseId = await findD1DatabaseId()
    const temporaryConfig = await writeTemporaryWranglerConfig(databaseId)

    try {
        await run([
            'wrangler',
            'd1',
            'migrations',
            'apply',
            databaseName,
            '--remote',
            '--config',
            temporaryConfig.configPath,
        ])
    } finally {
        await rm(temporaryConfig.directory, { recursive: true, force: true })
    }
}

async function main(): Promise<void> {
    if (!migrateOnly) {
        await run(dryRun ? ['wrangler', 'deploy', '--dry-run'] : ['wrangler', 'deploy'])
    }

    if (!dryRun) {
        await applyRemoteMigrations()
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
})
