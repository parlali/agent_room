import {
    buildPiRuntimeEntrypoint,
    piRuntimeConfigPathEnvKey,
    piRuntimeTokenEnvKey,
} from '../rooms/pi-runtime-contract'
import { assertStorageId } from './workspace-storage'

export const hostedRuntimeContainerPort = 3000
export const hostedRuntimeSleepAfter = '10m'
export const hostedRuntimeEntrypoint = buildPiRuntimeEntrypoint()

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
    return {
        entrypoint: [...hostedRuntimeEntrypoint],
        enableInternet: false,
        envVars: {
            [piRuntimeConfigPathEnvKey]: input.runtimeConfigPath,
            [piRuntimeTokenEnvKey]: input.runtimeToken,
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
