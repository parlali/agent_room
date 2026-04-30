import type { MaterializedRoomConfiguration, RoomPaths } from '../domain/types'
import { piRuntimeEngineProfile } from './pi-runtime-engine-profile'

export interface RuntimeEngineCommand {
    command: string
    args: string[]
}

export interface RuntimeEngineProfileBuildInput {
    roomId: string
    displayName: string
    port: number
    token: string
    paths: RoomPaths
    roomConfiguration: MaterializedRoomConfiguration
}

export interface RuntimeEngineProfileBuildResult {
    config: unknown
    env: Record<string, string>
}

export interface RuntimeEngineProfile {
    stateDirName: string
    runtimeConfigFileName: string
    runtimeEnvFileName: string
    runtimeLogFileName: string
    resolveCommand: () => RuntimeEngineCommand
    buildRuntimeProfile: (input: RuntimeEngineProfileBuildInput) => RuntimeEngineProfileBuildResult
}

export function getRuntimeEngineProfile(): RuntimeEngineProfile {
    return piRuntimeEngineProfile
}
