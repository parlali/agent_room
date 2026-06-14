import type {
    MaterializedRoomConfiguration,
    RoomPaths,
    RuntimeSandboxHardening,
    RuntimeSandboxIdentity,
} from '#/domain/domain-types'

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
    sandbox: RuntimeSandboxIdentity
    sandboxHardening?: RuntimeSandboxHardening
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
