const forwardedProcessEnvKeys = ['PATH', 'LANG', 'LC_ALL', 'TZ', 'BUN_INSTALL'] as const

export const reservedRoomRuntimeEnvKeys = new Set([
    'AGENT_ROOM_DATA_DIR',
    'AGENT_ROOM_ENCRYPTION_KEY_B64',
    'AGENT_ROOM_PI_RUNTIME_CONFIG_PATH',
    'AGENT_ROOM_PI_RUNTIME_TOKEN',
    'AGENT_ROOM_PI_STATE_DIR',
    'AGENT_ROOM_ROOT_EMAIL',
    'AGENT_ROOM_ROOT_PASSWORD',
    'AGENT_ROOM_SESSION_TTL_HOURS',
    'AGENT_ROOM_STORE_DIR',
    'AGENT_ROOM_WORKSPACE_DIR',
    'BUN_INSTALL',
    'DATABASE_URL',
    'HOME',
    'LANG',
    'LC_ALL',
    'MCP_AUTH_TOKEN',
    'NODE_ENV',
    'PATH',
    'PI_CODING_AGENT_DIR',
    'PORT',
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
