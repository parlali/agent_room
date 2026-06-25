import {
    buildPiRuntimeEntrypoint,
    hostedRuntimeRoomIdEnvKey,
    hostedRuntimeWorkspaceIdEnvKey,
    piRuntimeConfigPathEnvKey,
    piRuntimeTokenEnvKey,
} from '../rooms/pi-runtime-contract'
import { hostedRuntimePort } from './hosted-runtime-paths'
import { assertStorageId } from './workspace-storage'

export const hostedRuntimeContainerPort = hostedRuntimePort
export const hostedRuntimeSleepAfter = '10m'
export const hostedRuntimeEntrypoint = buildPiRuntimeEntrypoint()
export const hostedRuntimeDeniedHosts = [
    '169.254.169.254',
    '169.254.169.253',
    '100.100.100.200',
    'metadata',
    'metadata.google.internal',
    '*.metadata.google.internal',
    'metadata.azure.com',
    'metadata.aws.internal',
]

export interface HostedRuntimeIdentity {
    workspaceId: string
    roomId: string
}

export interface HostedRuntimeStartInput extends HostedRuntimeIdentity {
    runtimeConfigPath: string
    runtimeToken: string
    envVars?: Record<string, string>
}

export interface HostedRuntimeStartOptions {
    entrypoint: string[]
    enableInternet: false
    envVars: Record<string, string>
    labels: Record<string, string>
}

export interface HostedRuntimeCancellationOptions {
    instanceGetTimeoutMS: number
    portReadyTimeoutMS: number
    waitInterval: number
}

export interface HostedRuntimeStartAndWaitArgs {
    ports: number | number[]
    startOptions: HostedRuntimeStartOptions
    cancellationOptions: HostedRuntimeCancellationOptions
}

export interface HostedRuntimeContainerStub {
    startAndWaitForPorts: (args: HostedRuntimeStartAndWaitArgs) => Promise<void>
    setAllowedHosts: (hosts: string[]) => Promise<void>
    setDeniedHosts: (hosts: string[]) => Promise<void>
    getState: () => Promise<{
        status: 'running' | 'stopping' | 'stopped' | 'healthy' | 'stopped_with_code'
        lastChange: number
        exitCode?: number
    }>
    destroy: () => Promise<void>
    fetch: (request: Request) => Promise<Response>
}

export interface HostedRuntimeContainerNamespace {
    getByName: (name: string) => HostedRuntimeContainerStub
}

export function hostedRuntimeContainerName(input: HostedRuntimeIdentity): string {
    assertStorageId(input.workspaceId, 'workspaceId')
    assertStorageId(input.roomId, 'roomId')
    return `workspace:${input.workspaceId}:room:${input.roomId}`
}

export function buildHostedRuntimeStartOptions(
    input: HostedRuntimeStartInput,
): HostedRuntimeStartOptions {
    hostedRuntimeContainerName(input)
    const envVars = input.envVars ?? {}
    const conflicts = [
        [piRuntimeConfigPathEnvKey, input.runtimeConfigPath],
        [piRuntimeTokenEnvKey, input.runtimeToken],
        [hostedRuntimeWorkspaceIdEnvKey, input.workspaceId],
        [hostedRuntimeRoomIdEnvKey, input.roomId],
    ].filter(([key, value]) => envVars[key] !== undefined && envVars[key] !== value)
    if (conflicts.length > 0) {
        throw new Error(
            `Hosted runtime start env conflicts with canonical inputs: ${conflicts
                .map(([key]) => key)
                .join(', ')}`,
        )
    }
    return {
        entrypoint: [...hostedRuntimeEntrypoint],
        enableInternet: false,
        envVars: {
            ...envVars,
            [piRuntimeConfigPathEnvKey]: input.runtimeConfigPath,
            [piRuntimeTokenEnvKey]: input.runtimeToken,
            [hostedRuntimeWorkspaceIdEnvKey]: input.workspaceId,
            [hostedRuntimeRoomIdEnvKey]: input.roomId,
            PORT: String(hostedRuntimeContainerPort),
        },
        labels: {
            workspace_id: input.workspaceId,
            room_id: input.roomId,
            runtime: 'pi',
        },
    }
}
