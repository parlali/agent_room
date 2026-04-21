import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const mode = process.env.DBMATE_MODE ?? 'binary'
const databaseUrl =
    process.env.DATABASE_URL ??
    'postgres://agent_room:agent_room@127.0.0.1:5432/agent_room?sslmode=disable'
const subcommand = process.argv[2] ?? 'up'
const extraArgs = process.argv.slice(3)

if (mode !== 'binary' && mode !== 'docker') {
    throw new Error('DBMATE_MODE must be binary or docker')
}

function normalizeDockerDatabaseUrl(rawDatabaseUrl: string): string {
    const parsed = new URL(rawDatabaseUrl)
    if (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') {
        parsed.hostname = 'host.docker.internal'
    }
    if (!parsed.searchParams.has('sslmode')) {
        parsed.searchParams.set('sslmode', 'disable')
    }
    return parsed.toString()
}

const migrationDirHost = resolve('db/migrations')
const migrationDirContainer = '/workspace/db/migrations'
const effectiveDatabaseUrl =
    mode === 'docker' ? normalizeDockerDatabaseUrl(databaseUrl) : databaseUrl
const migrationDir = mode === 'docker' ? migrationDirContainer : migrationDirHost
const baseArgs = [
    '--url',
    effectiveDatabaseUrl,
    '--migrations-dir',
    migrationDir,
    subcommand,
    ...extraArgs,
]

const command = mode === 'binary' ? 'dbmate' : 'docker'
const args =
    mode === 'binary'
        ? baseArgs
        : [
              'run',
              '--rm',
              '--add-host',
              'host.docker.internal:host-gateway',
              '-v',
              `${process.cwd()}:/workspace`,
              '-w',
              '/workspace',
              'ghcr.io/amacneil/dbmate:2.28.0',
              ...baseArgs,
          ]

const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env,
})

if (result.error) {
    throw result.error
}

process.exit(result.status ?? 1)
