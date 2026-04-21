import { buildOpenClawRuntimeConfig } from './openclaw-config'
import type {
    RuntimeEngineCommand,
    RuntimeEngineProfile,
    RuntimeEngineProfileBuildInput,
} from './runtime-engine-profile'

function resolveOpenClawCommand(): RuntimeEngineCommand {
    return {
        command: 'openclaw',
        args: ['gateway', 'run'],
    }
}

function buildOpenClawRuntimeProfile(input: RuntimeEngineProfileBuildInput) {
    const config = buildOpenClawRuntimeConfig({
        roomId: input.roomId,
        displayName: input.displayName,
        port: input.port,
        paths: input.paths,
        roomConfiguration: input.roomConfiguration,
    })

    const env: Record<string, string> = {
        OPENCLAW_CONFIG_PATH: input.paths.runtimeConfigPath,
        OPENCLAW_GATEWAY_TOKEN: input.token,
        OPENCLAW_STATE_DIR: input.paths.engineStateDir,
        OPENCLAW_WORKSPACE_DIR: input.paths.workspaceDir,
        OPENCLAW_STORE_DIR: input.paths.storeDir,
        ...input.roomConfiguration.entitlements.env,
    }

    return {
        config,
        env,
    }
}

export const openClawRuntimeEngineProfile: RuntimeEngineProfile = {
    stateDirName: 'openclaw-state',
    runtimeConfigFileName: 'openclaw.config.json',
    runtimeEnvFileName: 'openclaw.env',
    runtimeLogFileName: 'openclaw.log',
    resolveCommand: resolveOpenClawCommand,
    buildRuntimeProfile: buildOpenClawRuntimeProfile,
}
