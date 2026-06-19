export const hostedRuntimeContainerPort = 3000
export const hostedRuntimeSleepAfter = '10m'

export const hostedRuntimeEntrypoint = [
    'bun',
    '--no-env-file',
    'run',
    'src/server/pi-runtime/main.ts',
] as const

export interface HostedRuntimeIdentity {
    workspaceId: string
    roomId: string
}

export interface HostedRuntimeStartInput extends HostedRuntimeIdentity {
    runtimeConfigPath: string
    runtimeToken: string
    controlPlaneOrigin: string
}

export interface HostedRuntimeStartOptions {
    entrypoint: string[]
    enableInternet: false
    envVars: Record<string, string>
    labels: Record<string, string>
}

function assertHostedRuntimeId(value: string, label: string): void {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
        throw new Error(`${label} must contain only letters, numbers, underscores, or hyphens`)
    }
}

export function hostedRuntimeContainerName(input: HostedRuntimeIdentity): string {
    assertHostedRuntimeId(input.workspaceId, 'workspaceId')
    assertHostedRuntimeId(input.roomId, 'roomId')
    return `workspace:${input.workspaceId}:room:${input.roomId}`
}

export function buildHostedRuntimeStartOptions(
    input: HostedRuntimeStartInput,
): HostedRuntimeStartOptions {
    hostedRuntimeContainerName(input)
    return {
        entrypoint: [...hostedRuntimeEntrypoint],
        enableInternet: false,
        envVars: {
            AGENT_ROOM_PI_RUNTIME_CONFIG_PATH: input.runtimeConfigPath,
            AGENT_ROOM_PI_RUNTIME_TOKEN: input.runtimeToken,
            AGENT_ROOM_HOSTED_WORKSPACE_ID: input.workspaceId,
            AGENT_ROOM_HOSTED_ROOM_ID: input.roomId,
            AGENT_ROOM_HOSTED_CONTROL_PLANE_ORIGIN: input.controlPlaneOrigin,
            PORT: String(hostedRuntimeContainerPort),
        },
        labels: {
            workspace_id: input.workspaceId,
            room_id: input.roomId,
            runtime: 'pi',
        },
    }
}
