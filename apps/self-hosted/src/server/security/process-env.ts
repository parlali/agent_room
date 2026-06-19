import { basename } from 'node:path'
import {
    piCodingAgentDirEnvKey,
    piRuntimeConfigPathEnvKey,
    piRuntimeStateDirEnvKey,
    piRuntimeTokenEnvKey,
} from '../rooms/pi-runtime-contract'

const forwardedProcessEnvKeys = ['PATH', 'LANG', 'LC_ALL', 'TZ', 'BUN_INSTALL'] as const

export const shellVisibleWorkspaceDirEnvKey = 'WORKSPACE_DIR'
export const shellVisibleStoreDirEnvKey = 'STORE_DIR'

export const reservedRoomRuntimeEnvKeys = new Set([
    'AGENT_ROOM_DATA_DIR',
    'AGENT_ROOM_ENCRYPTION_KEY_B64',
    'AGENT_ROOM_GITHUB_INSTALLATION_TOKEN',
    piRuntimeConfigPathEnvKey,
    piRuntimeTokenEnvKey,
    piRuntimeStateDirEnvKey,
    'AGENT_ROOM_ROOT_EMAIL',
    'AGENT_ROOM_ROOT_PASSWORD',
    'AGENT_ROOM_SESSION_TTL_HOURS',
    'AGENT_ROOM_STORE_DIR',
    'AGENT_ROOM_UNSAFE_ALLOW_UNSANDBOXED_SHELL',
    'AGENT_ROOM_WORKSPACE_DIR',
    'BUN_INSTALL',
    'DATABASE_URL',
    'GH_TOKEN',
    'GITHUB_TOKEN',
    'HOME',
    'LANG',
    'LC_ALL',
    'MCP_AUTH_TOKEN',
    'NODE_ENV',
    'PATH',
    piCodingAgentDirEnvKey,
    'PORT',
    shellVisibleStoreDirEnvKey,
    shellVisibleWorkspaceDirEnvKey,
    'TMPDIR',
    'TZ',
])

export function assertNoReservedRoomRuntimeEnvKeys(
    env: Record<string, string>,
    context = 'Room runtime environment',
): void {
    const conflicts = Object.keys(env)
        .map((key) => key.toUpperCase())
        .filter((key) => reservedRoomRuntimeEnvKeys.has(key))
        .sort()

    if (conflicts.length > 0) {
        throw new Error(`${context} cannot override reserved keys: ${conflicts.join(', ')}`)
    }
}

export function buildBoundedProcessEnv(
    overrides: Record<string, string | null | undefined> = {},
): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {}

    for (const key of forwardedProcessEnvKeys) {
        const value = process.env[key]
        if (value) {
            env[key] = value
        }
    }

    env.PATH ??= '/usr/local/bin:/usr/bin:/bin'
    env.LANG ??= 'C.UTF-8'
    env.LC_ALL ??= 'C.UTF-8'
    env.TZ ??= 'UTC'

    for (const [key, value] of Object.entries(overrides)) {
        if (value !== null && value !== undefined) {
            env[key] = value
        }
    }

    return env
}

export function disableImplicitEnvFileForCommand(command: string, args: string[]): string[] {
    if (basename(command) === 'bun' && !args.includes('--no-env-file')) {
        return ['--no-env-file', ...args]
    }
    return args
}
